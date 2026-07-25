// 通用 token 估算（CJK ≈ 0.6 tok/字，ASCII ≈ 0.3 tok/字符）
// 适用于豆包/大模型场景的粗略用量统计，非精确计费依据
export function estimateTokenUnits(text: string): number {
  let tokens = 0;
  for (const char of text) {
    tokens += char.charCodeAt(0) > 0x7F ? 0.6 : 0.3;
  }
  return tokens;
}

export function estimateTokens(text: string): number {
  return Math.ceil(estimateTokenUnits(text));
}
