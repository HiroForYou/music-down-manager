import type { WidgetTaskHandlerProps } from 'react-native-android-widget';

import { getLastWidgetState, getPlayerControllerRef, restoreWidgetState } from '../lib/widgetBridge';
import { renderWidgetByName } from './NowPlayingWidget';

// Tarea en segundo plano de los widgets: dibuja el estado actual y ejecuta los botones.
// Los botones controlan el reproductor mientras la app está viva (suena música o está en segundo plano).
export async function widgetTaskHandler(props: WidgetTaskHandlerProps) {
  const controller = getPlayerControllerRef().current;

  if (props.widgetAction === 'WIDGET_CLICK' && controller) {
    if (props.clickAction === 'PLAY_PAUSE') controller.togglePlay();
    else if (props.clickAction === 'NEXT') controller.next();
    else if (props.clickAction === 'PREV') controller.previous();
  }

  if (props.widgetAction === 'WIDGET_DELETED') return;

  const state = controller ? getLastWidgetState() : await restoreWidgetState();
  // Al pulsar play/pausa el estado real llega un instante después desde el reproductor; se anticipa aquí.
  const shown =
    props.widgetAction === 'WIDGET_CLICK' && props.clickAction === 'PLAY_PAUSE' && controller
      ? { ...state, playing: !state.playing }
      : state;
  const { width, height } = props.widgetInfo;
  props.renderWidget(renderWidgetByName(props.widgetInfo.widgetName, shown, { width, height }));
}
