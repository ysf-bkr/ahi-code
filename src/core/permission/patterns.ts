/**
 * İzin motorunun glob ve komut deseni eşleştirmesi.
 *
 * Saf fonksiyonlar: dosya sistemi ve `vscode` bağımlılığı yoktur. Motorda
 * kullanılan eşleştirme kuralları burada tek yerde tutulur; böylece deny/allow
 * davranışı doğrudan test edilebilir.
 */

/** Yol desenini düzenli ifadeye çevirir. `**` her derinliği, `*` tek parçayı eşler. */
export function globToRegex(glob: string): RegExp {
  let regex = '^';
  for (let i = 0; i < glob.length; i++) {
    const char = glob[i];
    if (char === undefined) break;
    if (char === '*') {
      if (glob[i + 1] === '*') {
        i++;
        if (glob[i + 1] === '/') {
          i++;
          regex += '(?:.*/)?';
        } else {
          regex += '.*';
        }
      } else {
        regex += '[^/]*';
      }
    } else if (char === '?') {
      regex += '[^/]';
    } else if ('\\.^$+{}()|[]'.includes(char)) {
      regex += '\\' + char;
    } else {
      regex += char;
    }
  }
  return new RegExp(`${regex}$`);
}

/**
 * Yol desenini hedef yolla eşleştirir.
 *
 * Desen yol ayırıcı içermiyorsa dosya adıyla da denenir (`*.pem` →
 * `certs/a.pem`). Geçersiz desende alt dize karşılaştırmasına düşer.
 */
export function matchPathPattern(pattern: string, target: string): boolean {
  if (!pattern) return false;
  const pat = pattern.trim().replace(/\\/g, '/');
  if (pat === '*' || pat === '**/*') return true;

  const normalizedTarget = String(target || '').replace(/\\/g, '/');
  if (pat === normalizedTarget) return true;

  try {
    const regex = globToRegex(pat);
    if (regex.test(normalizedTarget)) return true;

    if (!pat.includes('/')) {
      const baseName = normalizedTarget.split('/').pop() || normalizedTarget;
      if (regex.test(baseName)) return true;
    }
    return false;
  } catch {
    return normalizedTarget.includes(pat);
  }
}

/** Komut desenini (`npm test*`) komutla eşleştirir; büyük/küçük harf duyarsız. */
export function matchCommandPattern(pattern: string, command: string): boolean {
  if (!pattern) return false;
  const pat = pattern.trim();
  if (pat === '*' || pat === '**/*') return true;

  const normalizedCmd = String(command || '').trim();
  if (pat.toLowerCase() === normalizedCmd.toLowerCase()) return true;

  let regex = '^';
  for (let i = 0; i < pat.length; i++) {
    const char = pat[i];
    if (char === undefined) break;
    if (char === '*') {
      while (pat[i + 1] === '*') i++;
      regex += '.*';
    } else if (char === '?') {
      regex += '.';
    } else if ('\\.^$+{}()|[]'.includes(char)) {
      regex += '\\' + char;
    } else {
      regex += char;
    }
  }

  try {
    return new RegExp(`${regex}$`, 'i').test(normalizedCmd);
  } catch {
    return normalizedCmd.toLowerCase().includes(pat.toLowerCase());
  }
}

/** Tek bir `*`, `**` ya da `**\/*` deseni her şeyi kapsar mı? */
export function isBroadPattern(pattern: string): boolean {
  const value = pattern.trim().replace(/\\/g, '/');
  return value === '' || value === '*' || value === '**' || value === '**/*';
}
