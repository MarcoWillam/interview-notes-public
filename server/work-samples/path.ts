export function safeLocalWorkSamplePath(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 500)
    throw new Error('作品路径不安全。');
  const path = value.trim().replaceAll('\\', '/');
  if (
    path.startsWith('/') ||
    /^[a-z]:\//i.test(path) ||
    path.split('/').some((part) => !part || part === '.' || part === '..')
  )
    throw new Error('作品路径不安全。');
  return path;
}
