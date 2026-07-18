import { baseStyles } from './styles/baseStyles';
import { toolbarStyles } from './styles/toolbarStyles';
import { toastStyles } from './styles/toastStyles';
import { viewLayoutStyles } from './styles/viewLayoutStyles';
import { settingsSurfaceStyles } from './styles/settingsSurfaceStyles';
import { sessionListStyles } from './styles/sessionListStyles';
import { messageStyles } from './styles/messageStyles';
import { activityStyles } from './styles/activityStyles';
import { composerStyles } from './styles/composerStyles';
import { customUiStyles } from './styles/customUiStyles';
import { extensionEditorStyles } from './styles/extensionEditorStyles';
import { extensionPromptStyles } from './styles/extensionPromptStyles';
import { reducedMotionStyles } from './styles/reducedMotionStyles';

export const chatWebviewStyles = [
  baseStyles,
  toolbarStyles,
  toastStyles,
  viewLayoutStyles,
  settingsSurfaceStyles,
  sessionListStyles,
  messageStyles,
  activityStyles,
  composerStyles,
  customUiStyles,
  extensionEditorStyles,
  extensionPromptStyles,
  reducedMotionStyles,
].join('');
