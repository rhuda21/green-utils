import { storage } from "@vendetta/plugin";
import { findByStoreName } from "@vendetta/metro";
import { React, ReactNative } from "@vendetta/metro/common";

const { ScrollView, Text, View, Switch, StyleSheet, TouchableOpacity, Alert, Modal, TextInput } = ReactNative;

const GuildStore = findByStoreName("GuildStore");

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
  divider: { height: 1, backgroundColor: "#3f4147", marginVertical: 16 },
  
  // Modal layout
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.7)", justifyContent: "center", alignItems: "center", padding: 20 },
  modalContainer: { backgroundColor: "#313338", borderRadius: 16, padding: 20, width: "100%", maxWidth: 340, borderWidth: 1, borderColor: "#4e5058" },
  modalTitle: { color: "#f2f3f5", fontSize: 18, fontWeight: "700", marginBottom: 8 },
  modalSubtext: { color: "#949ba4", fontSize: 13, marginBottom: 16, lineHeight: 18 },
  input: { backgroundColor: "#1e1f22", borderRadius: 8, padding: 12, color: "#f2f3f5", fontSize: 15, borderWidth: 1, borderColor: "#4e5058", marginBottom: 20 },
  modalButtons: { flexDirection: "row", justifyContent: "flex-end", gap: 12 },
  btnCancel: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 6 },
  btnCancelText: { color: "#f2f3f5", fontSize: 14, fontWeight: "500" },
  btnConfirm: { backgroundColor: "#5865f2", paddingVertical: 10, paddingHorizontal: 16, borderRadius: 6 },
  btnConfirmText: { color: "#ffffff", fontSize: 14, fontWeight: "600" }
});

export default function Settings() {
  const guilds = React.useMemo(() => (GuildStore?.getGuilds ? Object.values(GuildStore.getGuilds()) : []) as any[], []);
  const [selectedGuildId, setSelectedGuildId] = React.useState<string>(guilds[0]?.id || "");
  const [, forceUpdate] = React.useReducer((x) => x + 1, 0);

  const [modalVisible, setModalVisible] = React.useState(false);
  const [passwordInput, setPasswordInput] = React.useState("");

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

  function handleSwitchChange(nextValue: boolean) {
    if (!nextValue) {
      delete pluginStorage.serverLockList[selectedGuildId];
      delete pluginStorage.serverPasswords[selectedGuildId];
      forceUpdate();
    } else {
      setPasswordInput("");
      setModalVisible(true);
    }
  }

  function saveServerLock() {
    if (!passwordInput || !passwordInput.trim()) {
      Alert.alert("Error", "Password cannot be left blank.");
      return;
    }
    pluginStorage.serverLockList[selectedGuildId] = true;
    pluginStorage.serverPasswords[selectedGuildId] = simpleHash(passwordInput);
    setModalVisible(false);
    forceUpdate();
  }

  return (
    <ScrollView style={s.page} contentContainerStyle={s.scrollContent}>
      <View style={s.headerContainer}>
        <Text style={s.header}>greenUtils</Text>
        <Text style={s.subheader}>Select a server to change its options.</Text>
      </View>

      <Text style={s.sectionHead}>Servers</Text>
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
          <Text style={s.sectionHead}>Options</Text>
          <View style={s.mainCard}>
            
            <View style={s.row}>
              <View style={s.rowTextContainer}>
                <Text style={s.rowTitle}>Lock Server</Text>
                <Text style={s.rowSubtext}>
                  Requires a password to view channels inside this server.
                </Text>
              </View>
              <Switch 
                value={isServerLocked} 
                onValueChange={handleSwitchChange}
                trackColor={{ false: "#4e5058", true: "#f23f43" }}
                thumbColor="#ffffff"
              />
            </View>

            <View style={s.divider} />

            <View style={s.row}>
              <View style={s.rowTextContainer}>
                <Text style={s.rowTitle}>Hide Images</Text>
                <Text style={s.rowSubtext}>
                  Blurs pictures, videos, and links in this server.
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
                <Text style={s.rowTitle}>Ask Password for Images</Text>
                <Text style={s.rowSubtext}>
                  Prompts for your password before unblurring images.
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

      {/* Password Prompt Modal */}
      <Modal
        transparent={true}
        visible={modalVisible}
        animationType="fade"
        onRequestClose={() => setModalVisible(false)}
      >
        <View style={s.modalOverlay}>
          <View style={s.modalContainer}>
            <Text style={s.modalTitle}>Set Password</Text>
            <Text style={s.modalSubtext}>
              Choose a password to protect this server.
            </Text>
            
            <TextInput
              style={s.input}
              placeholder="Password..."
              placeholderTextColor="#80848e"
              secureTextEntry={true}
              value={passwordInput}
              onChangeText={setPasswordInput}
            />

            <View style={s.modalButtons}>
              <TouchableOpacity style={s.btnCancel} onPress={() => setModalVisible(false)}>
                <Text style={s.btnCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.btnConfirm} onPress={saveServerLock}>
                <Text style={s.btnConfirmText}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

    </ScrollView>
  );
}