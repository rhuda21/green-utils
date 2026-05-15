import { storage } from "@vendetta/plugin";
import { findByProps, findByStoreName } from "@vendetta/metro";
import { React, ReactNative } from "@vendetta/metro/common";

const { ScrollView, Text, View, Switch, StyleSheet, TouchableOpacity, Alert } = ReactNative;

const GuildStore = findByStoreName("GuildStore");
const alerts = findByProps("showInputAlert");

interface PluginStorage {
  imageBlockList: Record<string, boolean>;
  serverPasswords: Record<string, string>;
  serverLockList: Record<string, boolean>;
  imageLockRequirePassword: boolean;
}

const pluginStorage = storage as unknown as PluginStorage;

pluginStorage.imageBlockList           ??= {};
pluginStorage.serverPasswords          ??= {};
pluginStorage.serverLockList           ??= {};
pluginStorage.imageLockRequirePassword ??= false;

function simpleHash(str: string): string {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  }
  return h.toString(16);
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#1e1f22" },
  scrollContent: { padding: 16, paddingBottom: 60 },
  headerContainer: { marginBottom: 20 },
  header: { color: "#f2f3f5", fontSize: 24, fontWeight: "800", letterSpacing: 0.5 },
  subheader: { color: "#949ba4", fontSize: 13, marginTop: 4 },
  sectionHead: { color: "#949ba4", fontSize: 12, fontWeight: "700", letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 10, marginTop: 16 },
  listCard: { backgroundColor: "#2b2d31", borderRadius: 12, borderWidth: 1, borderColor: "#35373c", overflow: "hidden" },
  guildRow: { flexDirection: "row", alignItems: "center", padding: 14 },
  guildRowActive: { backgroundColor: "#35373c" },
  guildRowDivider: { height: 1, backgroundColor: "#3f4147" },
  guildIndicator: { width: 4, height: 24, borderRadius: 2, marginRight: 12, backgroundColor: "transparent" },
  guildIndicatorActive: { backgroundColor: "#5865f2" },
  guildName: { color: "#dbdee1", fontSize: 16, fontWeight: "500", flex: 1 },
  guildNameActive: { color: "#ffffff", fontWeight: "700" },
  mainCard: { backgroundColor: "#2b2d31", borderRadius: 12, padding: 16, borderWidth: 1, borderColor: "#35373c" },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  rowTextContainer: { flex: 1, marginRight: 16 },
  rowTitle: { color: "#f2f3f5", fontSize: 16, fontWeight: "600" },
  rowSubtext: { color: "#949ba4", fontSize: 12, marginTop: 4, lineHeight: 16 },
  divider: { height: 1, backgroundColor: "#3f4147", marginVertical: 16 }
});

export default function Settings() {
  const guilds = React.useMemo(() => (GuildStore?.getGuilds ? Object.values(GuildStore.getGuilds()) : []) as any[], []);
  const [selectedGuildId, setSelectedGuildId] = React.useState<string>(guilds[0]?.id || "");
  const [, forceUpdate] = React.useReducer((x) => x + 1, 0);

  const isImageBlocked = !!pluginStorage.imageBlockList[selectedGuildId];
  const isServerLocked = !!pluginStorage.serverLockList[selectedGuildId];
  const requirePasswordForImages = pluginStorage.imageLockRequirePassword;

  function toggleImageBlocking(val: boolean) {
    pluginStorage.imageBlockList[selectedGuildId] = val;
    forceUpdate();
  }

  function toggleImagePasswordRequirement(val: boolean) {
    pluginStorage.imageLockRequirePassword = val;
    forceUpdate();
  }

  function handleServerLockToggle(guildId: string, turnOn: boolean) {
    if (!turnOn) {
      delete pluginStorage.serverLockList[guildId];
      delete pluginStorage.serverPasswords[guildId];
      forceUpdate();
    } else {
      const customAlert = alerts?.showInputAlert;

      if (customAlert) {
        customAlert({
          title: "Create Server Lock",
          placeholder: "Set protection master key...",
          secureTextEntry: true,
          confirmText: "Lock Entire Server",
          cancelText: "Cancel",
          onConfirm: (input: string) => {
            if (!input || !input.trim()) {
              Alert.alert("Failed", "Master password cannot be left blank.");
              return;
            }
            pluginStorage.serverLockList[guildId] = true;
            pluginStorage.serverPasswords[guildId] = simpleHash(input);
            forceUpdate();
          }
        });
      } else if ((Alert as any).prompt) {
        (Alert as any).prompt(
          "Create Server Lock",
          "Set protection master key:",
          [
            { text: "Cancel" },
            {
              text: "Lock Entire Server",
              onPress: (input?: string) => {
                if (!input || !input.trim()) {
                  Alert.alert("Failed", "Master password cannot be left blank.");
                  return;
                }
                pluginStorage.serverLockList[guildId] = true;
                pluginStorage.serverPasswords[guildId] = simpleHash(input);
                forceUpdate();
              }
            }
          ],
          "secure-text"
        );
      } else {
        Alert.alert("Error", "No secure input API detected on this client build.");
      }
    }
  }

  return (
    <ScrollView style={s.page} contentContainerStyle={s.scrollContent}>
      <View style={s.headerContainer}>
        <Text style={s.header}>greenUtils</Text>
        <Text style={s.subheader}>Select a server from the list below to configure security overrides.</Text>
      </View>

      <Text style={s.sectionHead}>Select Server</Text>
      <View style={s.listCard}>
        {guilds.map((g, idx) => {
          const isSelected = selectedGuildId === g.id;
          return (
            <View key={g.id}>
              <TouchableOpacity 
                activeOpacity={0.7}
                style={[s.guildRow, isSelected && s.guildRowActive]} 
                onPress={() => setSelectedGuildId(g.id)}
              >
                <View style={[s.guildIndicator, isSelected && s.guildIndicatorActive]} />
                <Text style={[s.guildName, isSelected && s.guildNameActive]}>
                  {g.name}
                </Text>
              </TouchableOpacity>
              {idx !== guilds.length - 1 && <View style={s.guildRowDivider} />}
            </View>
          );
        })}
      </View>

      {selectedGuildId && (
        <>
          <Text style={s.sectionHead}>Security Configuration Matrix</Text>
          <View style={s.mainCard}>
            
            <View style={s.row}>
              <View style={s.rowTextContainer}>
                <Text style={s.rowTitle}>Lock Server Infrastructure</Text>
                <Text style={s.rowSubtext}>
                  Restricts access to all internal rooms on this server behind a secure validation firewall gateway.
                </Text>
              </View>
              <Switch 
                value={isServerLocked} 
                onValueChange={(nextValue) => handleServerLockToggle(selectedGuildId, nextValue)}
                trackColor={{ false: "#4e5058", true: "#f23f43" }}
                thumbColor="#ffffff"
              />
            </View>

            <View style={s.divider} />

            <View style={s.row}>
              <View style={s.rowTextContainer}>
                <Text style={s.rowTitle}>Block Server Images</Text>
                <Text style={s.rowSubtext}>
                  Hide all media attachments and embeds behind blur flags across this specific server context.
                </Text>
              </View>
              <Switch 
                value={isImageBlocked} 
                onValueChange={toggleImageBlocking}
                trackColor={{ false: "#4e5058", true: "#5865f2" }}
                thumbColor="#ffffff"
              />
            </View>

            <View style={s.divider} />

            <View style={s.row}>
              <View style={s.rowTextContainer}>
                <Text style={s.rowTitle}>Require Password for Image Previews</Text>
                <Text style={s.rowSubtext}>
                  When enabled, viewing filtered image assets will prompt for your server lock password instead of automatically revealing them.
                </Text>
              </View>
              <Switch 
                value={requirePasswordForImages} 
                onValueChange={toggleImagePasswordRequirement}
                trackColor={{ false: "#4e5058", true: "#5865f2" }}
                thumbColor="#ffffff"
              />
            </View>

          </View>
        </>
      )}
    </ScrollView>
  );
}