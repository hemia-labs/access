export function environmentFile() {
  return process.env.NODE_ENV === 'production'
    ? '.env.production'
    : '.env.local';
}
