import { Tabs } from 'expo-router';

import { AppTabBar } from '../../components/AppTabBar';
import { colors } from '../../lib/theme';

export default function TabsLayout() {
  return (
    <Tabs
      initialRouteName="library"
      tabBar={(props) => <AppTabBar {...props} />}
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: colors.bg } }}
    >
      <Tabs.Screen name="library" options={{ title: 'Música' }} />
      <Tabs.Screen name="spotify" options={{ title: 'Spotify' }} />
      <Tabs.Screen name="index" options={{ title: 'Descargar' }} />
      <Tabs.Screen name="settings" options={{ title: 'Ajustes' }} />
    </Tabs>
  );
}
