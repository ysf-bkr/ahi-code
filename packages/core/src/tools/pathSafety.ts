import * as path from 'path';
import * as fs from 'fs';
import { isSecurityError, SecurityError } from '../shared/errors';

/**
 * Hedef yolu çalışma alanı sınırı içinde güvenle çözer.
 * Dizin dolaşma saldırılarını (örn. ../../etc/passwd) ve çalışma alanı
 * kökü dışındaki mutlak sistem erişimini engeller.
 *
 * Bilinen sınırlar (bu tehdit modeli için kabul edildi):
 * - TOCTOU: yol doğrulanır, sonra ayrı bir dosya sistemi çağrısında kullanılır;
 * aradaki eşzamanlı değişiklik kontrolü atlatabilir.
 * - Hardlink: çalışma alanı içindeki bir dosya, dışarıdaki bir dosyaya
 * hardlink ile bağlıysa tespit edilemez; aşağıdaki realpath kontrolü
 * yalnızca symlink kaçışını yakalar.
 */
export function resolveWorkspacePath(filePath: string, workspaceRoot?: string): string {
  if (!filePath || typeof filePath !== 'string') {
    throw new Error('Invalid file path parameter.');
  }

  if (!workspaceRoot) {
    throw new Error('No open workspace found.');
  }

  const rootNormalized = path.normalize(path.resolve(workspaceRoot));
  let resolvedPath: string;

  if (path.isAbsolute(filePath)) {
    resolvedPath = path.normalize(filePath);
  } else {
    resolvedPath = path.normalize(path.resolve(rootNormalized, filePath));
  }

  // macOS ve Windows dosya sistemleri büyük/küçük harfe duyarsızdır.
  const normalizeForCompare = (value: string): string =>
    process.platform === 'darwin' || process.platform === 'win32' ? value.toLowerCase() : value;
  const comparePath = normalizeForCompare(resolvedPath);
  const compareRoot = normalizeForCompare(rootNormalized);

  // Çözülen yolun çalışma alanı köküyle başladığından emin ol
  const isInside = comparePath === compareRoot || comparePath.startsWith(compareRoot + path.sep);

  if (!isInside) {
    throw new SecurityError(
      `Security violation: The specified path ('${filePath}') is outside the workspace boundaries ('${workspaceRoot}').`
    );
  }

  // Symlink hapsi kaçışını önlemek için dosya veya üst klasör varsa realpath kontrol et
  try {
    let checkPath = resolvedPath;
    while (!fs.existsSync(checkPath) && checkPath !== rootNormalized) {
      const parent = path.dirname(checkPath);
      if (parent === checkPath) break;
      checkPath = parent;
    }

    if (fs.existsSync(checkPath)) {
      const real = fs.realpathSync(checkPath);
      const realRoot = fs.existsSync(rootNormalized) ? fs.realpathSync(rootNormalized) : rootNormalized;
      const compareReal = normalizeForCompare(real);
      const compareRealRoot = normalizeForCompare(realRoot);
      const isRealInside =
        compareReal === compareRealRoot || compareReal.startsWith(compareRealRoot + path.sep);
      if (!isRealInside) {
        throw new SecurityError(
          `Security violation: The symbolic link (symlink) points outside the workspace: '${filePath}'`
        );
      }
    }
  } catch (err) {
    if (isSecurityError(err)) {
      throw err;
    }
    // Dosya henüz yok; normalize edilmiş yol kök içindeyse izin ver
  }

  return resolvedPath;
}
