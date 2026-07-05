import { defineConfig } from 'vitepress';

const startSidebar = [
  {
    text: 'Getting Started',
    items: [
      { text: 'Overview', link: '/getting-started/' },
      { text: 'Installation', link: '/getting-started/installation' },
      { text: 'Quick Start', link: '/getting-started/quick-start' },
      { text: 'Pi Setup', link: '/getting-started/pi-setup' }
    ]
  }
];

const guideSidebar = [
  {
    text: 'Guide',
    items: [
      { text: 'Overview', link: '/guide/' },
      { text: 'Feature Tour', link: '/guide/feature-tour' },
      { text: 'Tauren Sidebar', link: '/guide/sidebar' },
      { text: 'Sessions', link: '/guide/sessions' },
      { text: 'Session Diffs', link: '/guide/session-diffs' },
      { text: 'Trace Origin', link: '/guide/trace-origin' },
      { text: 'Adding Context', link: '/guide/context' },
      { text: 'Voice Input', link: '/guide/voice-input' },
      { text: 'Security & Privacy', link: '/guide/security-privacy' },
      { text: 'Pi Extensions', link: '/guide/pi-extensions' },
      { text: 'Settings', link: '/guide/settings' },
      { text: 'Troubleshooting', link: '/guide/troubleshooting' }
    ]
  }
];

const referenceSidebar = [
  {
    text: 'Reference',
    items: [
      { text: 'Overview', link: '/reference/' },
      { text: 'Commands', link: '/reference/commands' },
      { text: 'Settings', link: '/reference/settings' },
      { text: 'Slash Commands', link: '/reference/slash-commands' },
      { text: 'Hotkeys', link: '/reference/hotkeys' }
    ]
  }
];

const developmentSidebar = [
  {
    text: 'Development',
    items: [
      { text: 'Overview', link: '/development/' },
      { text: 'Architecture', link: '/development/architecture' },
      { text: 'UI Language', link: '/development/ui-language' },
      { text: 'Pi Integration', link: '/development/pi-integration' },
      { text: 'Webview', link: '/development/webview' },
      { text: 'Sessions', link: '/development/sessions' },
      { text: 'Diff Lifecycle', link: '/development/diff-lifecycle' },
      { text: 'Release Process', link: '/development/release' }
    ]
  },
  {
    text: 'Decisions',
    items: [
      { text: 'SDK over RPC', link: '/decisions/0001-sdk-over-rpc' },
      { text: 'Three-lane Model', link: '/decisions/0002-three-lane-model' },
      { text: 'Plugin UI Bridge', link: '/decisions/0003-plugin-ui-bridge' }
    ]
  }
];

export default defineConfig({
  title: 'Tauren',
  description: 'Transparent AI coding assistant for VS Code',
  base: '/vscode-tauren/',
  appearance: true,
  themeConfig: {
    search: {
      provider: 'local'
    },
    nav: [
      { text: 'Docs', link: '/getting-started/' },
      { text: 'Guide', link: '/guide/' },
      { text: 'Reference', link: '/reference/' },
      { text: 'Development', link: '/development/' },
      { text: 'GitHub', link: 'https://github.com/kaiwood/vscode-tauren' }
    ],
    sidebar: {
      '/getting-started/': startSidebar,
      '/guide/': guideSidebar,
      '/reference/': referenceSidebar,
      '/development/': developmentSidebar,
      '/decisions/': developmentSidebar
    },
    socialLinks: [
      { icon: 'github', link: 'https://github.com/kaiwood/vscode-tauren' }
    ]
  }
});
