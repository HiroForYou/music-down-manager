import 'expo-router/entry';

import { TurboModuleRegistry } from 'react-native';

// El widget de pantalla de inicio solo existe en builds que incluyen el módulo nativo.
try {
  if (TurboModuleRegistry.get('AndroidWidget')) {
    const { registerWidgetTaskHandler } = require('react-native-android-widget');
    const { widgetTaskHandler } = require('./widget/widgetTaskHandler');
    registerWidgetTaskHandler(widgetTaskHandler);
  }
} catch {
  // Sin widget: la app funciona igual.
}
