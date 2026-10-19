/**
 * Same obfuscation format as midautumn-reservation:
 * SHA-256(keyMaterial) -> AES-GCM-256, random 12-byte IV;
 * tokenCiphertext = base64(IV || encryptedToken || authTag).
 * NOT secret storage: ciphertext and keyMaterial are both public on GitHub Pages.
 */
function b64ToBytes(value) {
  const text = String(value ?? '').replace(/\s+/g, '');
  const binary = atob(text);
  return Uint8Array.from(binary, ch => ch.charCodeAt(0));
}

export async function decryptGitHubToken(tokenCiphertext, keyMaterial) {
  const cipher = String(tokenCiphertext ?? '').trim();
  const material = String(keyMaterial ?? '').trim();
  if (!cipher || !material) throw new Error('尚未配置 tokenCiphertext / keyMaterial，请先用 token-tool.html 生成');
  let packed;
  try { packed = b64ToBytes(cipher); }
  catch { throw new Error('tokenCiphertext 不是有效的 Base64 密文'); }
  if (packed.length < 29) throw new Error('Token 密文无效，请重新使用 token-tool.html 生成');
  if (!globalThis.crypto?.subtle) throw new Error('浏览器不支持安全加密环境；请使用 HTTPS 或 localhost 访问');
  const iv = packed.subarray(0, 12);
  const keyBytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(material));
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['decrypt']);
  let plain;
  try { plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, packed.subarray(12)); }
  catch { throw new Error('Token 解密失败：请检查 tokenCiphertext 和 keyMaterial 是否来自同一次生成'); }
  const token = new TextDecoder().decode(plain).trim();
  if (!token) throw new Error('Token 解密结果为空');
  return token;
}
