export const reducedMotionStyles = /* css */ `    body.vscode-reduce-motion *,
    body.vscode-reduce-motion *::before,
    body.vscode-reduce-motion *::after,
    body.tauren-animations-disabled *,
    body.tauren-animations-disabled *::before,
    body.tauren-animations-disabled *::after {
      animation: none !important;
      scroll-behavior: auto !important;
      transition: none !important;
    }

    body.vscode-reduce-motion .tauren-chat-surface,
    body.vscode-reduce-motion .tauren-chat-surface__face,
    body.vscode-reduce-motion .sessions,
    body.vscode-reduce-motion .session-tree,
    body.vscode-reduce-motion .composer,
    body.vscode-reduce-motion .status__spinner,
    body.vscode-reduce-motion .activity--running .activity__status::before,
    body.tauren-animations-disabled .tauren-chat-surface,
    body.tauren-animations-disabled .tauren-chat-surface__face,
    body.tauren-animations-disabled .sessions,
    body.tauren-animations-disabled .session-tree,
    body.tauren-animations-disabled .composer,
    body.tauren-animations-disabled .status__spinner,
    body.tauren-animations-disabled .activity--running .activity__status::before {
      will-change: auto;
    }

    @media (prefers-reduced-motion: reduce) {
      *,
      *::before,
      *::after {
        animation: none !important;
        scroll-behavior: auto !important;
        transition: none !important;
      }

      .tauren-chat-surface,
      .tauren-chat-surface__face,
      .sessions,
      .session-tree,
      .composer,
      .status__spinner,
      .activity--running .activity__status::before {
        will-change: auto;
      }
    }
`;
