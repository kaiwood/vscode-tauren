export const reducedMotionStyles = /* css */ `    body.vscode-reduce-motion *,
    body.vscode-reduce-motion *::before,
    body.vscode-reduce-motion *::after,
    body.tau-animations-disabled *,
    body.tau-animations-disabled *::before,
    body.tau-animations-disabled *::after {
      animation: none !important;
      scroll-behavior: auto !important;
      transition: none !important;
    }

    body.vscode-reduce-motion .tau-chat-surface,
    body.vscode-reduce-motion .tau-chat-surface__face,
    body.vscode-reduce-motion .sessions,
    body.vscode-reduce-motion .session-tree,
    body.vscode-reduce-motion .composer,
    body.vscode-reduce-motion .status__spinner,
    body.vscode-reduce-motion .activity--running .activity__status::before,
    body.vscode-reduce-motion .tau-stream-word,
    body.tau-animations-disabled .tau-chat-surface,
    body.tau-animations-disabled .tau-chat-surface__face,
    body.tau-animations-disabled .sessions,
    body.tau-animations-disabled .session-tree,
    body.tau-animations-disabled .composer,
    body.tau-animations-disabled .status__spinner,
    body.tau-animations-disabled .activity--running .activity__status::before,
    body.tau-animations-disabled .tau-stream-word {
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

      .tau-chat-surface,
      .tau-chat-surface__face,
      .sessions,
      .session-tree,
      .composer,
      .status__spinner,
      .activity--running .activity__status::before,
      .tau-stream-word {
        will-change: auto;
      }
    }
`;
