import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** 找到 wrangler 本地 D1 的 sqlite 文件；跨 Windows/macOS/Linux。 */
export function findLocalD1(root = '.wrangler/state/v3/d1') {
  if (!existsSync(root)) return '';
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(path);
      } else if (entry.isFile() && entry.name.endsWith('.sqlite') && !entry.name.startsWith('metadata')) {
        return path;
      }
    }
  }
  return '';
}
