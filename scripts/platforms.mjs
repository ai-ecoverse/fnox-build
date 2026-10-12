export const SCOPE = '@ai-ecoverse';

export const PLATFORMS = [
  { platform: 'darwin-arm64', asset: 'darwin-arm64', os: 'darwin', cpu: 'arm64', label: 'macOS on Apple silicon' },
  { platform: 'darwin-x64', asset: 'darwin-amd64', os: 'darwin', cpu: 'x64', label: 'macOS on Intel' },
  { platform: 'linux-arm64', asset: 'linux-arm64', os: 'linux', cpu: 'arm64', label: 'Linux on arm64 (static, musl)' },
  { platform: 'linux-x64', asset: 'linux-amd64', os: 'linux', cpu: 'x64', label: 'Linux on x86-64 (static, musl)' },
  { platform: 'windows-arm64', asset: 'windows-arm64', os: 'win32', cpu: 'arm64', label: 'Windows on arm64' },
  { platform: 'windows-x64', asset: 'windows-amd64', os: 'win32', cpu: 'x64', label: 'Windows on x86-64' },
];

export function assetName(target) {
  return `fnox-${target.asset}${target.os === 'win32' ? '.exe' : ''}`;
}

export function packageName(target) {
  return `${SCOPE}/fnox-${target.platform}`;
}
