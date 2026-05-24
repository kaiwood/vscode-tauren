# Tau UI Language

## Product names

- Tau: the VS Code extension and UI/workflow product.
- Pi: the backend agent engine and SDK runtime.
- Pi extension/plugin: package running inside the Pi runtime.
- Tau bridge: Tau-side adapter that maps Pi runtime/UI intent into VS Code/webview behavior.

## Surfaces

- View: the VS Code contributed sidebar view containing Tau.
- Native View Toolbar: VS Code title toolbar for Tau's view.
- Tau Header: internal top row inside the webview.
- Lane: one of the spatial side surfaces around chat.
  - Session List Lane: left lane for session files.
  - Chat Lane: center lane for transcript/composer.
  - Session Tree Lane: right lane for Pi tree navigation.
- Chat Face: front/back state of the Chat Lane.
  - Main Face: transcript/composer.
  - Settings Face: internal Tau settings surface for Pi engine/runtime details.
- Composer: input area for user prompts, commands, and interactions.
- Custom UI Surface: area for Pi extension UIs, either in a lane or a dialog
- Custom UI Theme: visual styling for Custom UI Surface.
- Plugin Bridge: Tau bridge for Pi extension UI calls.
- Dialog: modal overlay surface for important interactions.
- Toast: transient notification surface.
- Busy bar: Bar at the top of the composer containing Changes and Steer/Follow-up controls, shown when Pi is busy.
- Widget: small interactive element provided by Pi extensions
- Above widget: Widget above the composer
- Below widget: Widget below the composer
- Status bar: Provided by Pi extensions, below composer and below widgets, above the VS Code status bar.

## Runtime UI

- Custom UI Surface: Pi extension UI rendered inside Tau.
- Custom UI Theme: visual styling for Custom UI Surface.
- Plugin Bridge: Tau bridge for Pi extension UI calls.
- Composer: prompt input area.
