/* 名称、主题配色、布局参数集中在这里（改名只改这里）。纯数据，浏览器与 Node 测试共用。 */
(function (root) {
  'use strict';
  root.APP_CONFIG = {
    APP_NAME_ZH: '键盘思维导图',
    APP_NAME_EN: 'Markdown Mindmap',
    TAGLINE: '回车 / Tab 建图，Markdown 与图随时互转',
    STORAGE_KEY: 'mdmm.docs.v1',           // localStorage：多文档列表
    PREF_KEY: 'mdmm.prefs.v1',             // localStorage：主题、布局、面板开关
    HELP_KEY: 'mdmm.help.seen.v1',
    MAX_UNDO: 200,
    /* 主题：按层级自动配色。branch 给第一层分支轮流用，其子孙沿用分支色描边。 */
    THEMES: {
      fresh:  { name: '清爽', root: '#2f5bea', rootInk: '#ffffff', leafBg: '#ffffff', leafBgDark: '#1f2430', ink: '#1d2430', inkDark: '#e8ecf4',
                edge: '#9aa6bf', edgeDark: '#5f6b84',
                branch: ['#2f8fe8', '#2fb380', '#f0a030', '#e05a7a', '#8a63d2', '#20a8b8', '#d2784a', '#6a8f2e'] },
      warm:   { name: '暖色', root: '#c7461f', rootInk: '#ffffff', leafBg: '#fffaf3', leafBgDark: '#2a221c', ink: '#3a2a1e', inkDark: '#f2e8de',
                edge: '#c9a98d', edgeDark: '#7a6450',
                branch: ['#e07a2a', '#d9a521', '#b84a4a', '#8c6d3f', '#c45d8a', '#a0792b', '#d6672c', '#9d7a55'] },
      forest: { name: '墨绿', root: '#1f5f4b', rootInk: '#ffffff', leafBg: '#f4faf6', leafBgDark: '#182420', ink: '#1a2a24', inkDark: '#dfeee6',
                edge: '#8fb3a3', edgeDark: '#4f6d61',
                branch: ['#2e8b64', '#4f9a3a', '#2d8f9a', '#8a9a2e', '#3a7f8f', '#6c9a52', '#2f7a6a', '#5a8f7a'] },
      mono:   { name: '高对比', root: '#111111', rootInk: '#ffffff', leafBg: '#ffffff', leafBgDark: '#121212', ink: '#111111', inkDark: '#f4f4f4',
                edge: '#777777', edgeDark: '#9a9a9a',
                branch: ['#1a1a1a', '#444444', '#6b6b6b', '#2c2c2c', '#555555', '#7a7a7a', '#333333', '#606060'] }
    },
    DEFAULT_THEME: 'fresh',
    LAYOUTS: { mindmap: '左右平衡', tree: '向右树状', outline: '大纲' },
    DEFAULT_LAYOUT: 'mindmap',
    LAYOUT_PARAMS: { hgap: 44, vgap: 14, outlineIndent: 36, outlineGap: 8, maxTextWidth: 240, padX: 12, padY: 7, rootPadX: 18, rootPadY: 11 },
    FONT: { family: '"Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", system-ui, sans-serif', size: 14, rootSize: 18, lineHeight: 1.35 },
    PRIORITY_LABELS: ['', '1', '2', '3'],
    ICONS: ['⭐', '✅', '❗', '❓', '💡', '📌', '🎯', '🔥', '📚', '⏰', '💬', '🚀']
  };
})(typeof window !== 'undefined' ? window : globalThis);
