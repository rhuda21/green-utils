import { instead, before } from "@vendetta/patcher";
import { findByName, findByProps, findByStoreName } from "@vendetta/metro";
import { storage } from "@vendetta/plugin";
import { React, ReactNative } from "@vendetta/metro/common";
import Settings from "./Settings";

const { Text, View, TouchableOpacity, StyleSheet, Alert } = ReactNative;

// ─── Define Type Interfaces ───────────────────────────────────
interface PluginStorage {
  imageBlockList: Record<string, boolean>;
  channelPasswords: Record<string, string>;
  channelLockList: Record<string, boolean>;
}

// Cast storage to our typed interface safely
const pluginStorage = storage as unknown as PluginStorage;

// ─── Storage defaults ─────────────────────────────────────────
pluginStorage.imageBlockList   ??= {};
pluginStorage.channelPasswords ??= {};
pluginStorage.channelLockList  ??= {};

// ─── Module lookups ──────────────────────────────────────────
const GuildStore = findByStoreName("GuildStore");
const ChannelStore = findByStoreName("ChannelStore");
const ChannelView = findByProps("ChannelChatWrapper") || findByProps("ChannelChat");

const patches: (() => void)[] = [];
const unlockedChannels = new Set<string>();

/**
 * Very lightweight "hash" – matches the Settings file logic
 */
function simpleHash(str: string): string {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  }
  return h.toString(16);
}

// ─── Feature 1: Data-Level Image Blocking ────────────────────
function patchImageBlocking(): void {
  const createMessageContent = findByName("createMessageContent", false);
  const getChannel = findByProps("getChannel")?.getChannel;

  if (!createMessageContent || !getChannel) {
    console.warn("[ServerGuard] Required message preprocessing modules missing.");
    return;
  }

  const unpatch = before("default", createMessageContent, (args: any[]) => {
    const content = args[0];
    if (!content?.message?.channel_id || !content?.options) return;

    // 1. Resolve channel and guild ID context
    const channel = getChannel(content.message.channel_id);
    const guildId = channel?.guild_id;

    // 2. Intercept data streams if the guild has blocking toggled ON
    if (guildId && pluginStorage.imageBlockList[guildId]) {
      
      // Force native client media collapse flags
      content.options.inlineEmbedMedia = false;
      content.options.shouldObscureSpoiler = true;

      const message = content.message;
      
      // 3. Mark raw image files as spoilers natively
      if (message?.attachments?.length) {
        for (const attachment of message.attachments) {
          attachment.spoiler = true;
        }
      }

      // 4. Neutralize third-party embedded links (Gifs, Tenor links, etc)
      if (message?.embeds?.length) {
        for (const embed of message.embeds) {
          embed.type = "image_blocked_by_guard"; 
        }
      }
    }
  });

  patches.push(unpatch);
  console.log("[ServerGuard] Data-level image block interceptor ready.");
}

// ─── Feature 2: Password-Protected Channels ───────────────────
function initializeChannelLockPatch(): void {
  if (!ChannelView || !ChannelStore) {
    console.warn("[ServerGuard] Channel View components missing, skipping chat rule locks.");
    return;
  }

  const targetMethod = "ChannelChatWrapper" in ChannelView ? "ChannelChatWrapper" : "default";

  const unpatch = instead(targetMethod, ChannelView, (args: any[], orig: Function) => {
    const channelId = ChannelStore.getLastSelectedChannelId?.();

    if (channelId && pluginStorage.channelLockList[channelId] && !unlockedChannels.has(channelId)) {
      return React.createElement(LockScreen, {
        channelId,
        onUnlockCompleted: () => unlockedChannels.add(channelId)
      });
    }

    return orig(...args);
  });

  patches.push(unpatch);
  console.log(`[ServerGuard] Locked channel rules attached onto: ${targetMethod}`);
}

// ─── UI Components ────────────────────────────────────────────
function LockScreen({ channelId, onUnlockCompleted }: any) {
  const styles = StyleSheet.create({
    container: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#313338", padding: 24 },
    icon:      { fontSize: 56, marginBottom: 16 },
    title:     { color: "#f2f3f5", fontSize: 20, fontWeight: "700", marginBottom: 8 },
    subtitle:  { color: "#80848e", fontSize: 14, marginBottom: 32, textAlign: "center" },
    btn:       { backgroundColor: "#5865f2", paddingHorizontal: 32, paddingVertical: 14, borderRadius: 8, width: "100%", alignItems: "center" },
    btnText:   { color: "#fff", fontSize: 16, fontWeight: "600" },
  });

  function handleUnlock() {
    const storedHash = pluginStorage.channelPasswords[channelId];
    const alertPrompt = (Alert as any).prompt || findByProps("showInputAlert")?.showInputAlert;
    
    if (alertPrompt) {
      alertPrompt(
        "Channel Locked",
        "Enter password to unlock chat access:",
        [
          { text: "Cancel" },
          {
            text: "Unlock",
            onPress: (input?: string) => {
              if (simpleHash(input ?? "") === storedHash) {
                onUnlockCompleted();
              } else {
                Alert.alert("Error", "Invalid Password Configuration");
              }
            }
          }
        ],
        "secure-text"
      );
    } else {
      Alert.alert("Device Error", "Unable to map prompt interfaces. Lift block thresholds in Settings.");
    }
  }

  return React.createElement(
    View, { style: styles.container },
    React.createElement(Text, { style: styles.icon }, "🔒"),
    React.createElement(Text, { style: styles.title }, "Channel Locked"),
    React.createElement(Text, { style: styles.subtitle }, "This room is restricted behind a ServerGuard credentials validation wall."),
    React.createElement(
      TouchableOpacity, { style: styles.btn, onPress: handleUnlock },
      React.createElement(Text, { style: styles.btnText }, "Tap to Unlock")
    )
  );
}

// ─── Plugin Lifecycle ─────────────────────────────────────────
export default {
  settings: Settings,

  onLoad() {
    console.log("[ServerGuard] Plugin staging load runtime initialization...");
    
    // 1-second timeout loop handles late asynchronous rendering dependencies gracefully
    setTimeout(() => {
      try {
        patchImageBlocking();
        initializeChannelLockPatch();
        console.log("[ServerGuard] Core modules hooked cleanly.");
      } catch (e) {
        console.error("[ServerGuard] Lifecycle patch compilation failure:", e);
      }
    }, 1000);
  },

  onUnload() {
    patches.forEach((p) => p());
    patches.length = 0;
    unlockedChannels.clear();
    console.log("[ServerGuard] Unpatched modules safely.");
  },
};