import { storage } from "@vendetta/plugin";
import { findByProps, findByStoreName } from "@vendetta/metro";
import { React, ReactNative } from "@vendetta/metro/common";
import { Forms } from "@vendetta/ui/components";

const { ScrollView, Text, View, Switch, StyleSheet, TouchableOpacity, Alert } = ReactNative;
const { FormInput } = Forms;

const GuildStore   = findByStoreName("GuildStore");
const ChannelStore = findByStoreName("ChannelStore");

interface PluginStorage {
  imageBlockList: Record<string, boolean>;
  channelPasswords: Record<string, string>;
  channelLockList: Record<string, boolean>;
}

const pluginStorage = storage as unknown as PluginStorage;

function simpleHash(str: string): string {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  }
  return h.toString(16);
}

const s = StyleSheet.create({
  page:         { flex: 1, backgroundColor: "#1e1f22", padding: 16 },
  header:       { color: "#f2f3f5", fontSize: 22, fontWeight: "700", marginBottom: 4 },
  subheader:    { color: "#949ba4", fontSize: 13, marginBottom: 20 },
  sectionHead:  { color: "#949ba4", fontSize: 11, fontWeight: "700", letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 8, marginTop: 12 },
  card:         { backgroundColor: "#2b2d31", borderRadius: 12, padding: 14, marginBottom: 16, borderWidth: 1, borderColor: "#35373c" },
  grid:         { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 },
  chip:         { paddingHorizontal: 12, paddingVertical: 8, backgroundColor: "#313338", borderRadius: 8, borderWidth: 1, borderColor: "#3f4147" },
  chipSelected: { backgroundColor: "#5865f2", borderColor: "#5865f2" },
  chipText:     { color: "#b5bac1", fontSize: 13, fontWeight: "600" },
  chipTextSel:  { color: "#ffffff" },
  row:          { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 10 },
  divider:      { height: 1, backgroundColor: "#3f4147", marginVertical: 12 },
  btnSave:      { backgroundColor: "#248046", borderRadius: 8, paddingVertical: 12, alignItems: "center", marginTop: 8 },
  btnSaveText:  { color: "#fff", fontWeight: "600", fontSize: 14 },
  dangerText:   { color: "#f23f43", fontSize: 12, fontWeight: "600" }
});

export default function Settings() {
  const guilds = React.useMemo(() => (GuildStore?.getGuilds ? Object.values(GuildStore.getGuilds()) : []) as any[], []);
  const [selectedGuildId, setSelectedGuildId] = React.useState<string>(guilds[0]?.id || "");
  const [passwordInput, setPasswordInput] = React.useState("");
  const [, forceUpdate] = React.useReducer((x) => x + 1, 0);

  const activeChannels = React.useMemo(() => {
    if (!selectedGuildId || !ChannelStore?.getMutableGuildChannelsAll) return [];
    const allChannels = Object.values(ChannelStore.getMutableGuildChannelsAll());
    return allChannels.filter((c: any) => c.guild_id === selectedGuildId && (c.type === 0 || c.type === 2));
  }, [selectedGuildId]);

  const isImageBlocked = !!pluginStorage.imageBlockList[selectedGuildId];
  
  function toggleImageBlocking(val: boolean) {
    pluginStorage.imageBlockList[selectedGuildId] = val;
    forceUpdate();
  }

  function handleChannelToggle(channelId: string, isCurrentlyLocked: boolean) {
    if (isCurrentlyLocked) {
      delete pluginStorage.channelLockList[channelId];
      delete pluginStorage.channelPasswords[channelId];
      forceUpdate();
    } else {
      if (!passwordInput.trim()) {
        Alert.alert("Password Required", "Please enter an access key in the field below before checking this option.");
        return;
      }
      pluginStorage.channelLockList[channelId] = true;
      pluginStorage.channelPasswords[channelId] = simpleHash(passwordInput);
      setPasswordInput("");
      forceUpdate();
      Alert.alert("Success", "Channel lock rule applied safely.");
    }
  }

  return (
    <ScrollView style={s.page} contentContainerStyle={{ paddingBottom: 60 }}>
      <Text style={s.header}>ServerGuard Dashboard</Text>
      <Text style={s.subheader}>Select a server below to customize active moderation security blocks.</Text>

      <Text style={s.sectionHead}>1. Select Target Guild</Text>
      <View style={s.grid}>
        {guilds.map((g) => {
          const isSelected = selectedGuildId === g.id;
          return (
            <TouchableOpacity 
              key={g.id} 
              style={[s.chip, isSelected && s.chipSelected]} 
              onPress={() => setSelectedGuildId(g.id)}
            >
              <Text style={[s.chipText, isSelected && s.chipTextSel]}>
                {g.name}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {selectedGuildId ? (
        <>
          <Text style={s.sectionHead}>2. Server Media Rules</Text>
          <View style={s.card}>
            <View style={s.row}>
              <View style={{ flex: 1, marginRight: 8 }}>
                <Text style={{ color: "#f2f3f5", fontSize: 15, fontWeight: "600" }}>Block Server Images</Text>
                <Text style={{ color: "#949ba4", fontSize: 12, marginTop: 2 }}>
                  Forces media attachments and link embeds into tap-to-reveal blurs across this entire server.
                </Text>
              </View>
              <Switch 
                value={isImageBlocked} 
                onValueChange={toggleImageBlocking}
                trackColor={{ false: "#4e5058", true: "#5865f2" }}
              />
            </View>
          </View>

          <Text style={s.sectionHead}>3. Channel Access Control</Text>
          <View style={s.card}>
            <View style={{ marginBottom: 14 }}>
              <FormInput
                title="SHARED PROTECTION PASSWORD"
                placeholder="Type a password here first, then tap a channel below to lock it..."
                secureTextEntry={true}
                value={passwordInput}
                onChange={(v: string) => setPasswordInput(v)}
              />
            </View>

            <View style={s.divider} />

            {activeChannels.length === 0 ? (
              <Text style={{ color: "#949ba4", fontSize: 13, textAlign: "center", paddingVertical: 10 }}>
                No standard text/voice channels mapped in this environment context.
              </Text>
            ) : (
              activeChannels.map((ch: any, idx) => {
                const isLocked = !!pluginStorage.channelLockList[ch.id];
                return (
                  <View key={ch.id}>
                    <View style={s.row}>
                      <View>
                        <Text style={{ color: isLocked ? "#f23f43" : "#f2f3f5", fontSize: 14, fontWeight: "500" }}>
                          {isLocked ? `🔒 #${ch.name}` : `#${ch.name}`}
                        </Text>
                        <Text style={{ color: "#949ba4", fontSize: 11, marginTop: 1 }}>
                          {isLocked ? "Credentials validation required" : "Unrestricted public access flow"}
                        </Text>
                      </View>
                      <Switch
                        value={isLocked}
                        onValueChange={() => handleChannelToggle(ch.id, isLocked)}
                        trackColor={{ false: "#4e5058", true: "#f23f43" }}
                      />
                    </View>
                    {idx !== activeChannels.length - 1 && <View style={{ height: 1, backgroundColor: "#35373c", marginVertical: 4 }} />}
                  </View>
                );
              })
            )}
          </View>
        </>
      ) : (
        <Text style={{ color: "#949ba4", fontSize: 14, textAlign: "center", marginTop: 20 }}>
          Please connect to or select a server to initialize config matrices.
        </Text>
      )}
    </ScrollView>
  );
}