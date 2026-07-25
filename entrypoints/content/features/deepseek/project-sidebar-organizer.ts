import type {
  CurrentDeepSeekConversation,
  ProjectContext,
  ProjectContextState,
  ProjectConversation,
} from '../../../../core/types';
import {
  extractHistoryItems,
  normalizeHistoryOrganizerState,
  parseSessionId,
  type HistoryItem,
} from './history-organizer';

export interface ProjectSidebarOrganizerController {
  stop(): void;
  refreshLabels(): void;
}

export interface ProjectSidebarOrganizerLabels {
  title: string;
  empty: string;
  expandProject: (name: string) => string;
  collapseProject: (name: string) => string;
  showMore: string;
  showLess: string;
  moveCurrentToProject: (name: string) => string;
  removeCurrentFromProject: (name: string) => string;
  joinProject: string;
  joinProjectNamed: (name: string) => string;
  moveToProjectNamed: (name: string) => string;
  currentProjectNamed: (name: string) => string;
  removeFromProjectNamed: (name: string) => string;
  conversationActions: string;
  useNextConversation: (name: string) => string;
  cancelNextConversation: (name: string) => string;
  pendingNextConversation: string;
  untitledConversation: string;
  operationFailed: (message: string) => string;
  age: (timestamp: number) => string;
}

const PROJECT_CONTEXT_SCHEMA_VERSION = 2;
const PROJECT_SECTION_ID = 'dwplus-project-sidebar';
const PROJECT_STYLE_ID = 'dwplus-project-sidebar-css';
const PROJECT_HIDDEN_ATTR = 'data-dwplus-project-sidebar-hidden';
const NATIVE_MENU_ENHANCER_ATTR = 'data-dwplus-project-native-menu';
const PROJECT_LIMIT = 5;
const EMPTY_HISTORY_STATE = normalizeHistoryOrganizerState(null);
const NATIVE_MENU_TEXT = {
  delete: [0x5220, 0x9664],
  rename: [0x91cd, 0x547d, 0x540d],
  share: [0x5206, 0x4eab],
  pin: [0x7f6e, 0x9876],
} as const;

type ProjectSectionHandlers = Pick<
  Parameters<typeof renderProjectSidebar>[1],
  'onMoveCurrent' | 'onTogglePending' | 'onToggleProject' | 'onToggleShowAll'
  | 'onOpenProjectConversationMenu' | 'onRemoveConversationFromProject'
>;

interface BoundProjectSection extends HTMLElement {
  __dwplusProjectSidebarHandlers?: ProjectSectionHandlers;
  __dwplusProjectSidebarPointerHandled?: boolean;
}

interface ProjectConversationMenuState {
  conversationId: string;
  projectId: string;
}

interface NativeMenuConversation {
  conversationId: string;
  title: string;
  url: string;
}

export function startDeepSeekProjectSidebarOrganizer(
  getLabels: () => ProjectSidebarOrganizerLabels,
): ProjectSidebarOrganizerController {
  let stopped = false;
  let state: ProjectContextState | null = null;
  let statusMessage = '';
  let timer: ReturnType<typeof setTimeout> | null = null;
  let nativeMenuConversation: NativeMenuConversation | null = null;
  let projectConversationMenu: ProjectConversationMenuState | null = null;
  let rendering = false;
  let cachedHistoryItems: readonly HistoryItem[] = [];
  const expandedProjectIds = new Set<string>();
  const showAllProjectIds = new Set<string>();

  injectProjectSidebarStyles();

  const loadState = async () => {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_PROJECT_CONTEXT_STATE' });
      if (!isProjectContextState(response)) throw new Error('Invalid project context state.');
      applyState(response);
    } catch (error) {
      statusMessage = getLabels().operationFailed(getErrorMessage(error));
      console.error('DeepSeek++ failed to load project sidebar state', error);
      schedule();
    }
  };

  const applyState = (next: ProjectContextState) => {
    state = next;
    for (const project of next.projects) {
      if (!expandedProjectIds.has(project.id) && projectHasConversations(project.id, next.conversations)) {
        expandedProjectIds.add(project.id);
      }
    }
    statusMessage = '';
    schedule();
  };

  const schedule = () => {
    if (stopped || timer || rendering) return;
    timer = setTimeout(() => {
      timer = null;
      rendering = true;
      try {
        cachedHistoryItems = extractHistoryItems(document, EMPTY_HISTORY_STATE);
        renderProjectSidebar(document, {
          historyItems: cachedHistoryItems,
          state,
          labels: getLabels(),
          statusMessage,
          expandedProjectIds,
          showAllProjectIds,
          onToggleProject(projectId) {
            if (expandedProjectIds.has(projectId)) {
              expandedProjectIds.delete(projectId);
            } else {
              expandedProjectIds.add(projectId);
            }
            schedule();
          },
          onToggleShowAll(projectId) {
            if (showAllProjectIds.has(projectId)) {
              showAllProjectIds.delete(projectId);
            } else {
              showAllProjectIds.add(projectId);
            }
            schedule();
          },
          onOpenProjectConversationMenu(menu) {
            projectConversationMenu = isSameProjectConversationMenu(projectConversationMenu, menu) ? null : menu;
            schedule();
          },
          onRemoveConversationFromProject(conversationId) {
            void mutateProjectSidebarState(async () => {
              assertRuntimeSuccess(await chrome.runtime.sendMessage({
                type: 'REMOVE_CONVERSATION_FROM_PROJECT',
                payload: { conversationId },
              }));
              projectConversationMenu = null;
            });
          },
          onMoveCurrent(projectId) {
            void mutateProjectSidebarState(async () => {
              const project = state?.projects.find((item) => item.id === projectId);
              if (!project) throw new Error(`Project not found: ${projectId}`);
              const current = getCurrentConversation(getLabels(), cachedHistoryItems);
              if (!current) return;
              const currentMembership = state?.conversations.find((item) => item.conversationId === current.conversationId) ?? null;
              if (currentMembership?.projectId === projectId) {
                assertRuntimeSuccess(await chrome.runtime.sendMessage({
                  type: 'REMOVE_CONVERSATION_FROM_PROJECT',
                  payload: { conversationId: current.conversationId },
                }));
                return;
              }
              assertRuntimeSuccess(await chrome.runtime.sendMessage({
                type: 'ADD_CONVERSATION_TO_PROJECT',
                payload: { projectId, conversation: current },
              }));
            });
          },
          onTogglePending(projectId) {
            void mutateProjectSidebarState(async () => {
              assertRuntimeSuccess(await chrome.runtime.sendMessage({
                type: 'SET_PENDING_PROJECT_CONTEXT',
                payload: { projectId: state?.pendingProjectId === projectId ? null : projectId },
              }));
            });
          },
          nativeMenuConversation,
          activeProjectConversationMenu: projectConversationMenu,
          onNativeJoinProject(projectId) {
            void mutateProjectSidebarState(async () => {
              if (!nativeMenuConversation) return;
              assertRuntimeSuccess(await chrome.runtime.sendMessage({
                type: 'ADD_CONVERSATION_TO_PROJECT',
                payload: { projectId, conversation: nativeMenuConversation },
              }));
              nativeMenuConversation = null;
              removeNativeMenuEnhancements(document);
            });
          },
          onNativeRemoveProject() {
            void mutateProjectSidebarState(async () => {
              if (!nativeMenuConversation) return;
              assertRuntimeSuccess(await chrome.runtime.sendMessage({
                type: 'REMOVE_CONVERSATION_FROM_PROJECT',
                payload: { conversationId: nativeMenuConversation.conversationId },
              }));
              nativeMenuConversation = null;
              removeNativeMenuEnhancements(document);
            });
          },
        });
      } finally {
        rendering = false;
      }
    }, 100);
  };

  const mutateProjectSidebarState = async (mutation: () => Promise<void>) => {
    try {
      statusMessage = '';
      await mutation();
      await loadState();
    } catch (error) {
      statusMessage = getLabels().operationFailed(getErrorMessage(error));
      console.error('DeepSeek++ failed to update project sidebar state', error);
      schedule();
    }
  };

  const messageHandler = (msg: { type?: string; state?: unknown }) => {
    if (msg.type === 'PROJECT_CONTEXT_UPDATED' && isProjectContextState(msg.state)) {
      applyState(msg.state);
    }
  };

  const navigationHandler = () => {
    nativeMenuConversation = null;
    projectConversationMenu = null;
    schedule();
  };

  const clickCaptureHandler = (event: MouseEvent) => {
    const target = event.target;
    if (!(target instanceof Node)) return;
    if (target instanceof Element && target.closest(`#${PROJECT_SECTION_ID}`)) return;
    const conversation = findHistoryConversationForNode(target, cachedHistoryItems);
    if (conversation) {
      nativeMenuConversation = conversation;
      projectConversationMenu = null;
      schedule();
      return;
    }
    if (target instanceof Element && target.closest(`[${NATIVE_MENU_ENHANCER_ATTR}="true"]`)) return;
    // While a native conversation menu is open, clicks inside it (its own items,
    // padding, the injected panel) must not drop the enhancement context — only
    // clicks elsewhere clear it. Otherwise the injected panel flickers away the
    // moment the user touches a native menu item.
    if (nativeMenuConversation && target instanceof Element) {
      const openMenu = findNativeConversationMenu(document);
      if (openMenu?.contains(target)) return;
    }
    nativeMenuConversation = null;
  };

  void loadState();
  const observer = new MutationObserver(schedule);
  observer.observe(document.body, { childList: true, subtree: true });
  chrome.runtime.onMessage.addListener(messageHandler);
  document.addEventListener('click', clickCaptureHandler, true);
  window.addEventListener('popstate', navigationHandler);
  window.addEventListener('hashchange', navigationHandler);
  window.addEventListener('dpp:navigation', navigationHandler);
  schedule();

  return {
    refreshLabels() {
      schedule();
    },
    stop() {
      stopped = true;
      observer.disconnect();
      chrome.runtime.onMessage.removeListener(messageHandler);
      document.removeEventListener('click', clickCaptureHandler, true);
      window.removeEventListener('popstate', navigationHandler);
      window.removeEventListener('hashchange', navigationHandler);
      window.removeEventListener('dpp:navigation', navigationHandler);
      if (timer) clearTimeout(timer);
      document.getElementById(PROJECT_SECTION_ID)?.remove();
      removeNativeMenuEnhancements(document);
      restoreProjectHiddenRows(document);
    },
  };
}

export function renderProjectSidebar(
  root: ParentNode,
  options: {
    state: ProjectContextState | null;
    labels: ProjectSidebarOrganizerLabels;
    statusMessage: string;
    expandedProjectIds: ReadonlySet<string>;
    showAllProjectIds: ReadonlySet<string>;
    onToggleProject(projectId: string): void;
    onToggleShowAll(projectId: string): void;
    onOpenProjectConversationMenu(menu: ProjectConversationMenuState): void;
    onRemoveConversationFromProject(conversationId: string): void;
    onMoveCurrent(projectId: string): void;
    onTogglePending(projectId: string): void;
    nativeMenuConversation?: NativeMenuConversation | null;
    activeProjectConversationMenu?: ProjectConversationMenuState | null;
    onNativeJoinProject?(projectId: string): void;
    onNativeRemoveProject?(): void;
    historyItems?: readonly HistoryItem[];
  },
): HTMLElement | null {
  const historyItems = options.historyItems ?? extractHistoryItems(root, EMPTY_HISTORY_STATE);
  const mount = findProjectSidebarMount(root, historyItems);
  restoreProjectHiddenRows(root);

  if (!mount) {
    getElementById(root, PROJECT_SECTION_ID)?.remove();
    return null;
  }

  const section = ensureProjectSection(root, mount);
  renderProjectSection(section, historyItems, options);
  hideProjectHistoryRows(historyItems, options.state?.conversations ?? []);
  renderNativeMenuEnhancements(root, options);
  return section;
}

function renderProjectSection(
  section: HTMLElement,
  historyItems: readonly HistoryItem[],
  options: Parameters<typeof renderProjectSidebar>[1],
): void {
  const { state, labels } = options;
  const currentConversation = getCurrentConversation(labels, historyItems);
  const currentMembership = currentConversation && state
    ? state.conversations.find((item) => item.conversationId === currentConversation.conversationId) ?? null
    : null;

  section.replaceChildren();
  section.dataset.dwplusHistorySynthetic = 'true';
  section.appendChild(createSectionHeader(labels.title));

  if (options.statusMessage) {
    section.appendChild(createStatus(options.statusMessage));
  }

  if (!state || state.projects.length === 0) {
    section.appendChild(createEmpty(labels.empty));
    bindProjectSection(section, options);
    return;
  }

  const conversationsByProject = groupConversationsByProject(state);
  for (const project of sortProjects(state.projects, state.conversations)) {
    const conversations = conversationsByProject.get(project.id) ?? [];
    const expanded = options.expandedProjectIds.has(project.id);
    const showAll = options.showAllProjectIds.has(project.id);
    const projectBlock = document.createElement('div');
    projectBlock.className = 'dwplus-project-sidebar__project';

    const row = document.createElement('div');
    row.className = 'dwplus-project-sidebar__project-row';

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'dwplus-project-sidebar__project-toggle';
    toggle.dataset.dwplusProjectToggle = project.id;
    toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    toggle.title = expanded ? labels.collapseProject(project.name) : labels.expandProject(project.name);
    toggle.innerHTML = `
      ${folderIcon()}
      <span class="dwplus-project-sidebar__project-name">${escapeHtml(project.name)}</span>
      <span class="dwplus-project-sidebar__project-count">${conversations.length}</span>
    `;
    row.appendChild(toggle);

    const actions = document.createElement('span');
    actions.className = 'dwplus-project-sidebar__project-actions';
    if (currentConversation) {
      const sameProject = currentMembership?.projectId === project.id;
      actions.appendChild(createIconButton({
        action: 'move-current',
        projectId: project.id,
        label: sameProject ? labels.removeCurrentFromProject(project.name) : labels.moveCurrentToProject(project.name),
        icon: sameProject ? unlinkIcon() : addIcon(),
        active: sameProject,
      }));
    }
    actions.appendChild(createIconButton({
      action: 'toggle-pending',
      projectId: project.id,
      label: state.pendingProjectId === project.id
        ? labels.cancelNextConversation(project.name)
        : labels.useNextConversation(project.name),
      icon: clockIcon(),
      active: state.pendingProjectId === project.id,
    }));
    row.appendChild(actions);
    projectBlock.appendChild(row);

    if (state.pendingProjectId === project.id) {
      const pending = document.createElement('div');
      pending.className = 'dwplus-project-sidebar__pending';
      pending.textContent = labels.pendingNextConversation;
      projectBlock.appendChild(pending);
    }

    if (expanded) {
      const list = document.createElement('div');
      list.className = 'dwplus-project-sidebar__conversation-list';
      const visibleConversations = showAll ? conversations : conversations.slice(0, PROJECT_LIMIT);
      for (const conversation of visibleConversations) {
        list.appendChild(createConversationRow(conversation, project, labels, options.activeProjectConversationMenu));
      }
      if (conversations.length > PROJECT_LIMIT) {
        const showMore = document.createElement('button');
        showMore.type = 'button';
        showMore.className = 'dwplus-project-sidebar__show-more';
        showMore.dataset.dwplusProjectShowAll = project.id;
        showMore.textContent = showAll ? labels.showLess : labels.showMore;
        list.appendChild(showMore);
      }
      projectBlock.appendChild(list);
    }

    section.appendChild(projectBlock);
  }

  bindProjectSection(section, options);
}

function bindProjectSection(
  section: HTMLElement,
  options: ProjectSectionHandlers,
): void {
  const boundSection = section as BoundProjectSection;
  boundSection.__dwplusProjectSidebarHandlers = options;
  if (section.dataset.dwplusBound === 'true') return;
  section.dataset.dwplusBound = 'true';
  const handleProjectSectionAction = (event: Event): void => {
    const handlers = boundSection.__dwplusProjectSidebarHandlers;
    if (!handlers) return;
    const target = event.target;
    if (!(target instanceof Element)) return;

    const actionButton = target.closest<HTMLButtonElement>('[data-dwplus-project-action]');
    if (actionButton) {
      event.preventDefault();
      event.stopPropagation();
      const projectId = actionButton.dataset.dwplusProjectId;
      if (!projectId) return;
      if (actionButton.dataset.dwplusProjectAction === 'move-current') {
        handlers.onMoveCurrent(projectId);
      } else if (actionButton.dataset.dwplusProjectAction === 'toggle-pending') {
        handlers.onTogglePending(projectId);
      }
      return;
    }

    const removeProjectConversation = target.closest<HTMLButtonElement>('[data-dwplus-project-remove-conversation]');
    if (removeProjectConversation?.dataset.dwplusProjectConversationId) {
      event.preventDefault();
      event.stopPropagation();
      handlers.onRemoveConversationFromProject(removeProjectConversation.dataset.dwplusProjectConversationId);
      return;
    }

    const conversationMenu = target.closest<HTMLButtonElement>('[data-dwplus-project-conversation-menu]');
    if (conversationMenu?.dataset.dwplusProjectConversationId && conversationMenu.dataset.dwplusProjectId) {
      event.preventDefault();
      event.stopPropagation();
      handlers.onOpenProjectConversationMenu({
        conversationId: conversationMenu.dataset.dwplusProjectConversationId,
        projectId: conversationMenu.dataset.dwplusProjectId,
      });
      return;
    }

    const showAll = target.closest<HTMLButtonElement>('[data-dwplus-project-show-all]');
    if (showAll?.dataset.dwplusProjectShowAll) {
      event.preventDefault();
      handlers.onToggleShowAll(showAll.dataset.dwplusProjectShowAll);
      return;
    }

    const toggle = target.closest<HTMLButtonElement>('[data-dwplus-project-toggle]');
    if (toggle?.dataset.dwplusProjectToggle) {
      event.preventDefault();
      handlers.onToggleProject(toggle.dataset.dwplusProjectToggle);
    }
  };

  section.addEventListener('pointerdown', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (!target.closest('button')) return;
    boundSection.__dwplusProjectSidebarPointerHandled = true;
    handleProjectSectionAction(event);
    setTimeout(() => {
      boundSection.__dwplusProjectSidebarPointerHandled = false;
    }, 0);
  }, true);

  section.addEventListener('click', (event) => {
    if (boundSection.__dwplusProjectSidebarPointerHandled) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    handleProjectSectionAction(event);
  });
}

function ensureProjectSection(
  root: ParentNode,
  mount: { container: Element; before: Element | null },
): HTMLElement {
  let section = getElementById(root, PROJECT_SECTION_ID);
  if (!section) {
    section = document.createElement('section');
    section.id = PROJECT_SECTION_ID;
    section.className = 'dwplus-project-sidebar';
    section.setAttribute('aria-label', 'DeepSeek++ projects');
  }

  if (section.parentElement !== mount.container || section.nextElementSibling !== mount.before) {
    mount.container.insertBefore(section, mount.before);
  }
  return section;
}

function getElementById(root: ParentNode, id: string): HTMLElement | null {
  if (root instanceof Document) return root.getElementById(id);
  if (root instanceof DocumentFragment) return root.getElementById(id);
  return root.querySelector?.<HTMLElement>(`#${id}`) ?? null;
}

function findProjectSidebarMount(
  root: ParentNode,
  historyItems: readonly HistoryItem[],
): { container: Element; before: Element | null } | null {
  const firstHistoryElement = historyItems
    .map((item) => item.element)
    .find((element) => !element.closest(`#${PROJECT_SECTION_ID}`));
  if (firstHistoryElement?.parentElement) {
    const before = findHistorySectionBoundary(firstHistoryElement);
    return { container: before.parentElement ?? firstHistoryElement.parentElement, before };
  }

  const sidebar = root.querySelector?.('aside, nav, [role="navigation"]') ?? null;
  return sidebar ? { container: sidebar, before: null } : null;
}

function findHistorySectionBoundary(firstHistoryElement: HTMLElement): Element {
  let before: Element = firstHistoryElement;
  let previous = before.previousElementSibling;
  while (previous instanceof HTMLElement && isCompactHistoryLabel(previous)) {
    before = previous;
    previous = before.previousElementSibling;
  }
  return before;
}

function isCompactHistoryLabel(element: HTMLElement): boolean {
  if (element.matches('button, input, textarea, select, [role="button"], [role="link"]')) return false;
  if (element.querySelector('button, input, textarea, select, [role="button"], [role="link"]')) return false;
  if (element.querySelector('a[href*="/chat/s/"], a[href*="/a/chat/s/"], a[href*="chat_session_id="]')) return false;
  const text = element.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  return text.length > 0 && text.length <= 24;
}

function hideProjectHistoryRows(historyItems: readonly HistoryItem[], conversations: readonly ProjectConversation[]): void {
  const projectSessionIds = new Set(conversations.map((conversation) => conversation.conversationId));
  for (const item of historyItems) {
    if (!projectSessionIds.has(item.sessionId)) continue;
    item.element.setAttribute(PROJECT_HIDDEN_ATTR, 'true');
    item.element.hidden = true;
    item.element.style.setProperty('display', 'none', 'important');
  }
}

function restoreProjectHiddenRows(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>(`[${PROJECT_HIDDEN_ATTR}="true"]`).forEach((element) => {
    element.hidden = false;
    element.style.removeProperty('display');
    element.removeAttribute(PROJECT_HIDDEN_ATTR);
  });
}

function createSectionHeader(title: string): HTMLElement {
  const header = document.createElement('div');
  header.className = 'dwplus-project-sidebar__section-title';
  header.textContent = title;
  return header;
}

function createStatus(message: string): HTMLElement {
  const status = document.createElement('div');
  status.className = 'dwplus-project-sidebar__status';
  status.textContent = message;
  return status;
}

function createEmpty(message: string): HTMLElement {
  const empty = document.createElement('div');
  empty.className = 'dwplus-project-sidebar__empty';
  empty.textContent = message;
  return empty;
}

function createConversationRow(
  conversation: ProjectConversation,
  project: ProjectContext,
  labels: ProjectSidebarOrganizerLabels,
  activeMenu: ProjectConversationMenuState | null | undefined,
): HTMLElement {
  const row = document.createElement('div');
  row.className = 'dwplus-project-sidebar__conversation-row';
  row.dataset.dwplusProjectConversationRow = conversation.conversationId;
  row.appendChild(createConversationLink(conversation, labels));

  const menuButton = document.createElement('button');
  menuButton.type = 'button';
  menuButton.className = 'dwplus-project-sidebar__conversation-menu-button';
  menuButton.dataset.dwplusProjectConversationMenu = 'true';
  menuButton.dataset.dwplusProjectConversationId = conversation.conversationId;
  menuButton.dataset.dwplusProjectId = project.id;
  menuButton.title = labels.conversationActions;
  menuButton.setAttribute('aria-label', labels.conversationActions);
  menuButton.innerHTML = moreIcon();
  row.appendChild(menuButton);

  if (activeMenu?.conversationId === conversation.conversationId && activeMenu.projectId === project.id) {
    const menu = document.createElement('div');
    menu.className = 'dwplus-project-sidebar__conversation-menu';
    menu.dataset.dwplusHistorySynthetic = 'true';
    menu.setAttribute('role', 'menu');
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'dwplus-project-sidebar__conversation-menu-item';
    remove.dataset.dwplusProjectRemoveConversation = 'true';
    remove.dataset.dwplusProjectConversationId = conversation.conversationId;
    remove.setAttribute('role', 'menuitem');
    remove.innerHTML = `${unlinkIcon()}<span>${escapeHtml(labels.removeFromProjectNamed(project.name))}</span>`;
    menu.appendChild(remove);
    row.appendChild(menu);
  }

  return row;
}

function createConversationLink(conversation: ProjectConversation, labels: ProjectSidebarOrganizerLabels): HTMLElement {
  const link = document.createElement('a');
  link.className = 'dwplus-project-sidebar__conversation';
  link.href = normalizeConversationHref(conversation);
  link.dataset.dwplusProjectConversationId = conversation.conversationId;
  link.innerHTML = `
    <span class="dwplus-project-sidebar__conversation-title">${escapeHtml(conversation.title || labels.untitledConversation)}</span>
    <span class="dwplus-project-sidebar__conversation-age">${escapeHtml(labels.age(conversation.lastSeenAt))}</span>
  `;
  return link;
}

function createIconButton(options: {
  action: string;
  projectId: string;
  label: string;
  icon: string;
  active?: boolean;
}): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'dwplus-project-sidebar__icon-button';
  button.dataset.dwplusProjectAction = options.action;
  button.dataset.dwplusProjectId = options.projectId;
  button.title = options.label;
  button.setAttribute('aria-label', options.label);
  if (options.active) button.dataset.active = 'true';
  button.innerHTML = options.icon;
  return button;
}

function renderNativeMenuEnhancements(
  root: ParentNode,
  options: Parameters<typeof renderProjectSidebar>[1],
): void {
  removeNativeMenuEnhancements(root);
  if (!options.state || !options.nativeMenuConversation || options.state.projects.length === 0) return;

  const menu = findNativeConversationMenu(root);
  if (!menu) return;

  const membership = options.state.conversations
    .find((conversation) => conversation.conversationId === options.nativeMenuConversation?.conversationId) ?? null;
  const currentProject = membership
    ? options.state.projects.find((project) => project.id === membership.projectId) ?? null
    : null;

  const panel = document.createElement('div');
  panel.className = 'dwplus-project-native-menu';
  panel.setAttribute(NATIVE_MENU_ENHANCER_ATTR, 'true');
  panel.dataset.dwplusHistorySynthetic = 'true';

  if (currentProject) {
    const remove = createNativeMenuButton({
      action: 'remove',
      label: options.labels.removeFromProjectNamed(currentProject.name),
      icon: unlinkIcon(),
    });
    panel.appendChild(remove);
  }

  const header = document.createElement('div');
  header.className = 'dwplus-project-native-menu__header';
  header.innerHTML = `${folderIcon()}<span>${escapeHtml(options.labels.joinProject)}</span>`;
  panel.appendChild(header);

  for (const project of options.state.projects) {
    const sameProject = membership?.projectId === project.id;
    const item = createNativeMenuButton({
      action: 'join',
      projectId: project.id,
      label: sameProject
        ? options.labels.currentProjectNamed(project.name)
        : membership
          ? options.labels.moveToProjectNamed(project.name)
          : options.labels.joinProjectNamed(project.name),
      icon: folderIcon(),
      active: sameProject,
    });
    panel.appendChild(item);
  }

  bindNativeMenuEnhancement(panel, options);
  placeNativeMenuEnhancement(menu, panel);
}

function createNativeMenuButton(options: {
  action: 'join' | 'remove';
  label: string;
  icon: string;
  projectId?: string;
  active?: boolean;
}): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'dwplus-project-native-menu__item';
  button.dataset.dwplusProjectNativeAction = options.action;
  if (options.projectId) button.dataset.dwplusProjectId = options.projectId;
  if (options.active) button.dataset.active = 'true';
  button.innerHTML = `${options.icon}<span>${escapeHtml(options.label)}</span>`;
  return button;
}

function bindNativeMenuEnhancement(
  panel: HTMLElement,
  options: Pick<Parameters<typeof renderProjectSidebar>[1], 'onNativeJoinProject' | 'onNativeRemoveProject'>,
): void {
  let handledPointerDown = false;
  const handleNativeAction = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest<HTMLButtonElement>('[data-dwplus-project-native-action]');
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    if (button.dataset.dwplusProjectNativeAction === 'remove') {
      options.onNativeRemoveProject?.();
      return;
    }
    const projectId = button.dataset.dwplusProjectId;
    if (projectId) options.onNativeJoinProject?.(projectId);
  };

  panel.addEventListener('pointerdown', (event) => {
    handledPointerDown = true;
    handleNativeAction(event);
    setTimeout(() => {
      handledPointerDown = false;
    }, 0);
  }, true);

  panel.addEventListener('click', (event) => {
    if (handledPointerDown) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    handleNativeAction(event);
  });
}

function placeNativeMenuEnhancement(menu: HTMLElement, panel: HTMLElement): void {
  const deleteItem = findNativeDeleteMenuItem(menu);
  if (deleteItem?.parentElement === menu) {
    menu.insertBefore(panel, deleteItem);
    return;
  }
  menu.appendChild(panel);
}

function findNativeDeleteMenuItem(menu: HTMLElement): HTMLElement | null {
  for (const item of Array.from(menu.querySelectorAll<HTMLElement>('button, [role="menuitem"], div'))) {
    const text = normalizeCompactText(item.textContent ?? '');
    if (text === nativeMenuText('delete') || /^delete$/i.test(text)) return item;
  }
  return null;
}

function findNativeConversationMenu(root: ParentNode): HTMLElement | null {
  const candidates = Array.from(root.querySelectorAll<HTMLElement>('[role="menu"], [role="dialog"], [class*="menu"], [class*="popover"], [class*="dropdown"]'))
    .filter((element) => !element.closest(`#${PROJECT_SECTION_ID}`))
    .filter((element) => element.getAttribute(NATIVE_MENU_ENHANCER_ATTR) !== 'true')
    .filter(isNativeConversationMenuCandidate);
  return candidates.find((candidate) => !candidates.some((other) => other !== candidate && candidate.contains(other))) ?? null;
}

function isNativeConversationMenuCandidate(element: HTMLElement): boolean {
  const text = normalizeCompactText(element.textContent ?? '');
  if (!text) return false;
  const hasRename = text.includes(nativeMenuText('rename')) || /\brename\b/i.test(text);
  const hasDelete = text.includes(nativeMenuText('delete')) || /\bdelete\b/i.test(text);
  const hasShareOrPin = text.includes(nativeMenuText('share')) ||
    text.includes(nativeMenuText('pin')) ||
    /\bshare\b|\bpin\b/i.test(text);
  return hasRename && hasDelete && hasShareOrPin;
}

function removeNativeMenuEnhancements(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>(`[${NATIVE_MENU_ENHANCER_ATTR}="true"]`).forEach((element) => {
    element.remove();
  });
}

function groupConversationsByProject(state: ProjectContextState): Map<string, ProjectConversation[]> {
  const grouped = new Map<string, ProjectConversation[]>();
  for (const conversation of state.conversations) {
    const list = grouped.get(conversation.projectId) ?? [];
    list.push(conversation);
    grouped.set(conversation.projectId, list);
  }
  for (const list of grouped.values()) {
    list.sort((a, b) => b.lastSeenAt - a.lastSeenAt);
  }
  return grouped;
}

function sortProjects(projects: readonly ProjectContext[], conversations: readonly ProjectConversation[]): ProjectContext[] {
  const latestByProject = new Map<string, number>();
  for (const conversation of conversations) {
    latestByProject.set(
      conversation.projectId,
      Math.max(latestByProject.get(conversation.projectId) ?? 0, conversation.lastSeenAt),
    );
  }
  return [...projects].sort((a, b) => {
    const latestDiff = (latestByProject.get(b.id) ?? b.updatedAt) - (latestByProject.get(a.id) ?? a.updatedAt);
    return latestDiff || b.updatedAt - a.updatedAt;
  });
}

function projectHasConversations(projectId: string, conversations: readonly ProjectConversation[]): boolean {
  return conversations.some((conversation) => conversation.projectId === projectId);
}

function isSameProjectConversationMenu(
  current: ProjectConversationMenuState | null,
  next: ProjectConversationMenuState,
): boolean {
  return current?.conversationId === next.conversationId && current.projectId === next.projectId;
}

function findHistoryConversationForNode(node: Node, items: readonly HistoryItem[]): NativeMenuConversation | null {
  const item = items.find((candidate) => candidate.element.contains(node));
  if (!item) return null;
  return {
    conversationId: item.sessionId,
    title: item.title,
    url: findHistoryHref(item.element, item.sessionId),
  };
}

function findHistoryHref(element: HTMLElement, sessionId: string): string {
  const anchors = Array.from(element.querySelectorAll<HTMLAnchorElement>('a[href]'));
  const anchor = anchors.find((candidate) => parseSessionId(candidate.href) === sessionId);
  return anchor?.href ?? new URL(`/a/chat/s/${encodeURIComponent(sessionId)}`, location.origin).href;
}

function getCurrentConversation(
  labels: ProjectSidebarOrganizerLabels,
  historyItems: readonly HistoryItem[] = extractHistoryItems(document, EMPTY_HISTORY_STATE),
): CurrentDeepSeekConversation | null {
  const conversationId = parseSessionId(location.href);
  if (!conversationId) return null;
  const historyTitle = historyItems.find((item) => item.sessionId === conversationId)?.title;
  return {
    conversationId,
    title: historyTitle || getCurrentConversationTitle(labels),
    url: location.href,
  };
}

function getCurrentConversationTitle(labels: ProjectSidebarOrganizerLabels): string {
  const title = document.title
    .replace(/\s*[-|]\s*DeepSeek.*$/i, '')
    .trim();
  return title || labels.untitledConversation;
}

function normalizeConversationHref(conversation: ProjectConversation): string {
  if (conversation.url.trim()) return conversation.url;
  return new URL(`/a/chat/s/${encodeURIComponent(conversation.conversationId)}`, location.origin).href;
}

function isProjectContextState(value: unknown): value is ProjectContextState {
  if (!value || typeof value !== 'object') return false;
  const state = value as ProjectContextState;
  return state.schemaVersion === PROJECT_CONTEXT_SCHEMA_VERSION &&
    Array.isArray(state.projects) &&
    Array.isArray(state.conversations) &&
    (state.pendingProjectId === null || typeof state.pendingProjectId === 'string');
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizeCompactText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function nativeMenuText(key: keyof typeof NATIVE_MENU_TEXT): string {
  return String.fromCodePoint(...NATIVE_MENU_TEXT[key]);
}

function assertRuntimeSuccess(response: unknown): void {
  if (
    response &&
    typeof response === 'object' &&
    (response as { ok?: unknown }).ok === false
  ) {
    throw new Error(String((response as { error?: unknown }).error ?? 'Runtime request failed.'));
  }
}

function escapeHtml(value: string): string {
  const div = document.createElement('div');
  div.textContent = value;
  return div.innerHTML;
}

function folderIcon(): string {
  return '<svg class="dwplus-project-sidebar__icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3.75 6.75a2 2 0 0 1 2-2h4.1l2 2h6.4a2 2 0 0 1 2 2v8.5a2 2 0 0 1-2 2H5.75a2 2 0 0 1-2-2V6.75Z"/></svg>';
}

function addIcon(): string {
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
}

function unlinkIcon(): string {
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.5 12h7M9.5 7.5l-2 2a3.54 3.54 0 0 0 5 5l1-1M14.5 16.5l2-2a3.54 3.54 0 0 0-5-5l-1 1"/></svg>';
}

function clockIcon(): string {
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"/></svg>';
}

function moreIcon(): string {
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h.01M12 12h.01M19 12h.01"/></svg>';
}

function injectProjectSidebarStyles(): void {
  if (document.getElementById(PROJECT_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = PROJECT_STYLE_ID;
  style.textContent = `
    #${PROJECT_SECTION_ID} {
      --dwplus-project-accent: #4f6ff5;
      --dwplus-project-line: color-mix(in srgb, currentColor 13%, transparent);
      --dwplus-project-soft: color-mix(in srgb, currentColor 6%, transparent);
      --dwplus-project-soft-hover: color-mix(in srgb, currentColor 10%, transparent);
      --dwplus-project-active: color-mix(in srgb, var(--dwplus-project-accent) 14%, transparent);
      --dwplus-project-muted: color-mix(in srgb, currentColor 54%, transparent);
      box-sizing: border-box;
      display: grid;
      gap: 4px;
      margin: 12px 0 10px;
      padding: 0 14px;
      color: inherit;
      font: 14px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif;
    }
    #${PROJECT_SECTION_ID} * {
      box-sizing: border-box;
    }
    #${PROJECT_SECTION_ID} .dwplus-project-sidebar__section-title {
      padding: 8px 0 5px;
      color: var(--dwplus-project-muted);
      font-size: 12px;
      font-weight: 560;
      letter-spacing: 0;
    }
    #${PROJECT_SECTION_ID} .dwplus-project-sidebar__project {
      display: grid;
      gap: 2px;
      min-width: 0;
    }
    #${PROJECT_SECTION_ID} .dwplus-project-sidebar__project-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: center;
      gap: 4px;
      min-height: 34px;
      border-radius: 8px;
    }
    #${PROJECT_SECTION_ID} .dwplus-project-sidebar__project-row:hover {
      background: var(--dwplus-project-soft);
    }
    #${PROJECT_SECTION_ID} button,
    #${PROJECT_SECTION_ID} a {
      font: inherit;
    }
    #${PROJECT_SECTION_ID} .dwplus-project-sidebar__project-toggle {
      display: grid;
      grid-template-columns: 20px minmax(0, 1fr) auto;
      align-items: center;
      gap: 8px;
      min-width: 0;
      width: 100%;
      min-height: 34px;
      padding: 0 7px 0 2px;
      border: 0;
      border-radius: 8px;
      outline: none;
      background: transparent;
      color: inherit;
      text-align: left;
      cursor: pointer;
    }
    #${PROJECT_SECTION_ID} .dwplus-project-sidebar__project-toggle:focus-visible,
    #${PROJECT_SECTION_ID} .dwplus-project-sidebar__icon-button:focus-visible,
    #${PROJECT_SECTION_ID} .dwplus-project-sidebar__show-more:focus-visible,
    #${PROJECT_SECTION_ID} .dwplus-project-sidebar__conversation:focus-visible {
      outline: 2px solid color-mix(in srgb, var(--dwplus-project-accent) 60%, currentColor);
      outline-offset: 2px;
    }
    #${PROJECT_SECTION_ID} .dwplus-project-sidebar__icon {
      width: 18px;
      height: 18px;
      fill: none;
      stroke: currentColor;
      stroke-width: 1.9;
      stroke-linecap: round;
      stroke-linejoin: round;
      color: var(--dwplus-project-muted);
    }
    #${PROJECT_SECTION_ID} .dwplus-project-sidebar__project-name,
    #${PROJECT_SECTION_ID} .dwplus-project-sidebar__conversation-title {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    #${PROJECT_SECTION_ID} .dwplus-project-sidebar__project-count {
      color: var(--dwplus-project-muted);
      font-size: 12px;
      font-variant-numeric: tabular-nums;
    }
    #${PROJECT_SECTION_ID} .dwplus-project-sidebar__project-actions {
      display: flex;
      align-items: center;
      gap: 2px;
      padding-right: 2px;
      opacity: 0;
      transition: opacity 140ms ease;
    }
    #${PROJECT_SECTION_ID} .dwplus-project-sidebar__project-row:hover .dwplus-project-sidebar__project-actions,
    #${PROJECT_SECTION_ID} .dwplus-project-sidebar__project-row:focus-within .dwplus-project-sidebar__project-actions {
      opacity: 1;
    }
    #${PROJECT_SECTION_ID} .dwplus-project-sidebar__icon-button {
      display: inline-grid;
      place-items: center;
      width: 26px;
      height: 26px;
      padding: 0;
      border: 0;
      border-radius: 7px;
      background: transparent;
      color: var(--dwplus-project-muted);
      cursor: pointer;
    }
    #${PROJECT_SECTION_ID} .dwplus-project-sidebar__icon-button:hover,
    #${PROJECT_SECTION_ID} .dwplus-project-sidebar__icon-button[data-active="true"] {
      background: var(--dwplus-project-active);
      color: color-mix(in srgb, var(--dwplus-project-accent) 82%, currentColor);
    }
    #${PROJECT_SECTION_ID} .dwplus-project-sidebar__icon-button svg {
      width: 16px;
      height: 16px;
      fill: none;
      stroke: currentColor;
      stroke-width: 1.9;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    #${PROJECT_SECTION_ID} .dwplus-project-sidebar__pending {
      margin: -1px 0 3px 30px;
      color: color-mix(in srgb, var(--dwplus-project-accent) 78%, currentColor);
      font-size: 11px;
    }
    #${PROJECT_SECTION_ID} .dwplus-project-sidebar__conversation-list {
      display: grid;
      gap: 1px;
      margin: 0 0 4px 30px;
      min-width: 0;
    }
    #${PROJECT_SECTION_ID} .dwplus-project-sidebar__conversation-row {
      position: relative;
      display: grid;
      grid-template-columns: minmax(0, 1fr) 26px;
      align-items: center;
      gap: 8px;
      min-width: 0;
      min-height: 30px;
      border-radius: 8px;
    }
    #${PROJECT_SECTION_ID} .dwplus-project-sidebar__conversation-row:hover {
      background: var(--dwplus-project-soft-hover);
    }
    #${PROJECT_SECTION_ID} .dwplus-project-sidebar__conversation {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: center;
      gap: 8px;
      min-width: 0;
      min-height: 30px;
      padding: 0 0 0 8px;
      color: inherit;
      text-decoration: none;
    }
    #${PROJECT_SECTION_ID} .dwplus-project-sidebar__conversation-age {
      color: var(--dwplus-project-muted);
      font-size: 12px;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    #${PROJECT_SECTION_ID} .dwplus-project-sidebar__conversation-menu-button {
      display: inline-grid;
      place-items: center;
      width: 24px;
      height: 24px;
      padding: 0;
      border: 0;
      border-radius: 7px;
      background: transparent;
      color: var(--dwplus-project-muted);
      cursor: pointer;
      opacity: 0;
    }
    #${PROJECT_SECTION_ID} .dwplus-project-sidebar__conversation-row:hover .dwplus-project-sidebar__conversation-menu-button,
    #${PROJECT_SECTION_ID} .dwplus-project-sidebar__conversation-row:focus-within .dwplus-project-sidebar__conversation-menu-button {
      opacity: 1;
    }
    #${PROJECT_SECTION_ID} .dwplus-project-sidebar__conversation-menu-button:hover {
      background: var(--dwplus-project-soft);
      color: inherit;
    }
    #${PROJECT_SECTION_ID} .dwplus-project-sidebar__conversation-menu-button svg,
    #${PROJECT_SECTION_ID} .dwplus-project-sidebar__conversation-menu-item svg {
      width: 16px;
      height: 16px;
      fill: none;
      stroke: currentColor;
      stroke-width: 1.9;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    #${PROJECT_SECTION_ID} .dwplus-project-sidebar__conversation-menu {
      position: absolute;
      z-index: 2147483647;
      top: 28px;
      right: 2px;
      display: grid;
      min-width: 178px;
      padding: 6px;
      border: 1px solid var(--dwplus-project-line);
      border-radius: 12px;
      background: color-mix(in srgb, canvas 94%, currentColor 6%);
      box-shadow: 0 14px 34px rgba(15, 23, 42, 0.16);
    }
    #${PROJECT_SECTION_ID} .dwplus-project-sidebar__conversation-menu-item {
      display: grid;
      grid-template-columns: 18px minmax(0, 1fr);
      align-items: center;
      gap: 10px;
      min-height: 34px;
      padding: 0 10px;
      border: 0;
      border-radius: 8px;
      background: transparent;
      color: inherit;
      text-align: left;
      cursor: pointer;
    }
    #${PROJECT_SECTION_ID} .dwplus-project-sidebar__conversation-menu-item:hover {
      background: var(--dwplus-project-soft-hover);
    }
    #${PROJECT_SECTION_ID} .dwplus-project-sidebar__show-more {
      width: fit-content;
      max-width: 100%;
      min-height: 28px;
      padding: 0 8px;
      border: 0;
      border-radius: 8px;
      background: transparent;
      color: var(--dwplus-project-muted);
      text-align: left;
      cursor: pointer;
    }
    #${PROJECT_SECTION_ID} .dwplus-project-sidebar__show-more:hover {
      background: var(--dwplus-project-soft);
      color: inherit;
    }
    #${PROJECT_SECTION_ID} .dwplus-project-sidebar__empty,
    #${PROJECT_SECTION_ID} .dwplus-project-sidebar__status {
      padding: 8px;
      border-radius: 8px;
      background: var(--dwplus-project-soft);
      color: var(--dwplus-project-muted);
      font-size: 12px;
    }
    .dwplus-project-native-menu {
      display: grid;
      gap: 2px;
      min-width: 178px;
      margin: 4px 0;
      padding: 5px 0;
      border-top: 1px solid color-mix(in srgb, currentColor 12%, transparent);
      color: inherit;
      font: inherit;
    }
    .dwplus-project-native-menu__header {
      display: grid;
      grid-template-columns: 20px minmax(0, 1fr);
      align-items: center;
      gap: 10px;
      min-height: 32px;
      padding: 0 12px;
      color: color-mix(in srgb, currentColor 58%, transparent);
      font-size: 12px;
    }
    .dwplus-project-native-menu__item {
      display: grid;
      grid-template-columns: 20px minmax(0, 1fr);
      align-items: center;
      gap: 10px;
      min-height: 34px;
      width: 100%;
      padding: 0 12px;
      border: 0;
      border-radius: 8px;
      background: transparent;
      color: inherit;
      font: inherit;
      text-align: left;
      cursor: pointer;
    }
    .dwplus-project-native-menu__item:hover,
    .dwplus-project-native-menu__item[data-active="true"] {
      background: color-mix(in srgb, currentColor 8%, transparent);
    }
    .dwplus-project-native-menu svg {
      width: 18px;
      height: 18px;
      fill: none;
      stroke: currentColor;
      stroke-width: 1.9;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
  `;
  document.head.appendChild(style);
}
