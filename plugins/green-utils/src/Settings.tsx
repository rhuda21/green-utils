import { storage } from "@vendetta/plugin";
import { findByProps, findByStoreName } from "@vendetta/metro";
import { React, ReactNative } from "@vendetta/metro/common";

const { ScrollView, Text, View, Switch, StyleSheet, TouchableOpacity, Alert } = ReactNative;

const GuildStore = findByStoreName("GuildStore");
const ChannelStore = findByStoreName("ChannelStore");
const ChannelPropsFallback = findByProps("getChannel", "getGuildChannels") || findByProps("getMutableGuildChannelsAll");

const alerts = findByProps("showInputAlert");

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
  channelListHead: { color: "#f2f3f5", fontSize: 14, fontWeight: "700", marginBottom: 12 },
  channelItem: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 12 },
  channelDivider: { height: 1, backgroundColor: "#35373c" },
  channelLeft: { flexDirection: "row", alignItems: "center", flex: 1, marginRight: 16 },
  channelHash: { color: "#80848e", fontSize: 16, marginRight: 8, fontWeight: "600" },
  channelHashLocked: { color: "#f23f43" },
  channelName: { color: "#dbdee1", fontSize: 15, fontWeight: "500" },
  channelNameLocked: { color: "#f23f43", fontWeight: "600" },
  noChannels: { color: "#949ba4", fontSize: 13, textAlign: "center", paddingVertical: 16, fontStyle: "italic" }
});

export default function Settings() {
  const guilds = React.useMemo(() => (GuildStore?.getGuilds ? Object.values(GuildStore.getGuilds()) : []) as any[], []);
  const [selectedGuildId, setSelectedGuildId] = React.useState<string>(guilds[0]?.id || "");
  const [, forceUpdate] = React.useReducer((x) => x + 1, 0);

  const activeChannels = React.useMemo(() => {
    if (!selectedGuildId) return [];
    
    const getChannelsModule = findByProps("getChannels") || findByProps("getGuildChannels") || ChannelPropsFallback;
    if (getChannelsModule) {
      const channelData = getChannelsModule.getChannels?.(selectedGuildId) || getChannelsModule.getGuildChannels?.(selectedGuildId);
      if (channelData && typeof channelData === "object") {
        const list = Array.isArray(channelData) ? channelData : Object.values(channelData);
        return list.filter((c: any) => c && (c.type === 0 || c.type === 2));
      }
    }

    if (ChannelStore?.getMutableGuildChannelsAll) {
      const allChannels = Object.values(ChannelStore.getMutableGuildChannelsAll());
      return allChannels.filter((c: any) => c && c.guild_id === selectedGuildId && (c.type === 0 || c.type === 2));
    }

    if (ChannelPropsFallback?.getMutableGuildChannelsAll) {
      const allChannels = Object.values(ChannelPropsFallback.getMutableGuildChannelsAll());
      return allChannels.filter((c: any) => c && c.guild_id === selectedGuildId && (c.type === 0 || c.type === 2));
    }

    return [];
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
      const targetAlert = alerts?.showInputAlert || (Alert as any).prompt;

      if (!targetAlert) {
        Alert.alert("Error", "No secure input API detected on this device configuration.");
        return;
      }

      targetAlert({
        title: "Create Lock Rule",
        placeholder: "Set protection key...",
        secureTextEntry: true,
        confirmText: "Lock Channel",
        cancelText: "Cancel",
        onConfirm: (input: string) => {
          if (!input || !input.trim()) {
            Alert.alert("Failed", "Password cannot be left blank.");
            return;
          }
          pluginStorage.channelLockList[channelId] = true;
          pluginStorage.channelPasswords[channelId] = simpleHash(input);
          forceUpdate();
        }
      });
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
          <Text style={s.sectionHead}>Settings Matrix</Text>
          <View style={s.mainCard}>
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

            <Text style={s.channelListHead}>Channel Privacy Blocks</Text>

            {activeChannels.length === 0 ? (
              <Text style={s.noChannels}>No supported text or voice channels inside this guild environment.</Text>
            ) : (
              activeChannels.map((ch: any, idx) => {
                const isLocked = !!pluginStorage.channelLockList[ch.id];
                return (
                  <View key={ch.id}>
                    <View style={s.channelItem}>
                      <View style={s.channelLeft}>
                        <Text style={[s.channelHash, isLocked && s.channelHashLocked]}>
                          {isLocked ? "🔒" : "#"}
                        </Text>
                        <Text style={[s.channelName, isLocked && s.channelNameLocked]}>
                          {ch.name}
                        </Text>
                      </View>
                      <Switch
                        value={isLocked}
                        onValueChange={() => handleChannelToggle(ch.id, isLocked)}
                        trackColor={{ false: "#4e5058", true: "#f23f43" }}
                        thumbColor="#ffffff"
                      />
                    </View>
                    {idx !== activeChannels.length - 1 && <View style={s.channelDivider} />}
                  </View>
                );
              })
            )}
          </View>
        </>
      )}
    </ScrollView>
  );
}