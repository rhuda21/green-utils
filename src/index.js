import { instead, after } from "@vendetta/patcher";
import { findByProps, findByStoreName } from "@vendetta/metro";
import { storage } from "@vendetta/plugin";
import { registerSettings } from "@vendetta/settings";
import Settings from "./Settings";

// ─── Storage defaults ─────────────────────────────────────────
// storage.imageBlockList  = { [guildId: string]: boolean }
// storage.channelPasswords = { [channelId: string]: string }
// storage.channelLockList  = { [channelId: string]: boolean }

storage.imageBlockList   ??= {};
storage.channelPasswords ??= {};
storage.channelLockList  ??= {};

// ─── Module lookups ──────────────────────────────────────────
const GuildStore   = findByStoreName("GuildStore");
const ChannelStore = findByStoreName("ChannelStore");
const MessageStore = findByStoreName("MessageStore");

// The component that renders image/video attachments in a message
const MediaComponent = findByProps("renderAttachment", "renderMedia");
// The component that renders the channel text-area / message input
const ChatInput      = findByProps("ChatInput");
// The component wrapping the whole channel view
const ChannelView    = findByProps("ChannelChatWrapper");

const patches = [];

// ─── Feature 1: Image blocking per-server ────────────────────
/**
 * Patches the attachment renderer.
 * When the current guild has image-blocking enabled we replace
 * image/video/gif attachments with a small placeholder element.
 */
function patchImageBlocking() {
  if (!MediaComponent) return;

  const unpatch = instead("renderAttachment", MediaComponent, (args, orig) => {
    const { attachment } = args[0] ?? {};
    const guildId = GuildStore.getLastSelectedGuildId?.();

    if (
      guildId &&
      storage.imageBlockList[guildId] &&
      attachment?.content_type?.startsWith("image")
    ) {
      // Return a simple React element as the placeholder
      const { React } = window.vendetta.metro.common;
      return React.createElement(
        "View",
        { style: { padding: 8, backgroundColor: "#2b2d31", borderRadius: 4 } },
        React.createElement(
          "Text",
          { style: { color: "#80848e", fontSize: 12 } },
          "🚫 Image hidden by ServerGuard"
        )
      );
    }

    return orig(...args);
  });

  patches.push(unpatch);
}

// ─── Feature 2: Password-protected channels ───────────────────
/**
 * Tracks which channels the user has already unlocked this session.
 * The password is stored in plugin storage (hashed below).
 */
const unlockedChannels = new Set();

/**
 * Very lightweight "hash" – just so we aren't storing plaintext.
 * For a real plugin you'd use a proper crypto hash.
 */
function simpleHash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  }
  return h.toString(16);
}

/**
 * Ask the user for the channel password via a native Alert.
 * Returns true if they typed the right one.
 */
async function promptForPassword(channelId) {
  const { Alert } = window.vendetta.metro.common.ReactNative;
  const storedHash = storage.channelPasswords[channelId];

  return new Promise((resolve) => {
    Alert.prompt(
      "Channel locked",
      "Enter the password to view this channel.",
      [
        { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
        {
          text: "Unlock",
          onPress: (input) => {
            if (simpleHash(input ?? "") === storedHash) {
              unlockedChannels.add(channelId);
              resolve(true);
            } else {
              resolve(false);
            }
          },
        },
      ],
      "secure-text"
    );
  });
}

/**
 * Patches the channel view so that if the current channel is
 * password-locked and not yet unlocked, we show a lock screen
 * instead of the chat.
 */
function patchChannelLock() {
  if (!ChannelView) return;

  const unpatch = instead("ChannelChatWrapper", ChannelView, (args, orig) => {
    const { React } = window.vendetta.metro.common;
    const channelId = ChannelStore.getLastSelectedChannelId?.();

    if (
      channelId &&
      storage.channelLockList[channelId] &&
      !unlockedChannels.has(channelId)
    ) {
      // Show lock screen; trigger password prompt on mount
      return React.createElement(
        LockScreen,
        { channelId, onUnlock: () => orig(...args) }
      );
    }

    return orig(...args);
  });

  patches.push(unpatch);
}

/**
 * Simple lock-screen component shown in place of the channel.
 */
function LockScreen({ channelId, onUnlock }) {
  const { React }    = window.vendetta.metro.common;
  const { Text, View, TouchableOpacity, StyleSheet } = window.vendetta.metro.common.ReactNative;

  const styles = StyleSheet.create({
    container: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#313338" },
    icon:      { fontSize: 48, marginBottom: 12 },
    title:     { color: "#f2f3f5", fontSize: 18, fontWeight: "600", marginBottom: 8 },
    subtitle:  { color: "#80848e", fontSize: 14, marginBottom: 24 },
    btn:       { backgroundColor: "#5865f2", paddingHorizontal: 24, paddingVertical: 12, borderRadius: 8 },
    btnText:   { color: "#fff", fontSize: 15, fontWeight: "600" },
  });

  async function handleUnlock() {
    const ok = await promptForPassword(channelId);
    if (ok) onUnlock?.();
  }

  return React.createElement(
    View, { style: styles.container },
    React.createElement(Text, { style: styles.icon }, "🔒"),
    React.createElement(Text, { style: styles.title }, "Channel locked"),
    React.createElement(Text, { style: styles.subtitle }, "This channel is protected by ServerGuard."),
    React.createElement(
      TouchableOpacity, { style: styles.btn, onPress: handleUnlock },
      React.createElement(Text, { style: styles.btnText }, "Unlock")
    )
  );
}

// ─── Plugin lifecycle ─────────────────────────────────────────
export default {
  onLoad() {
    patchImageBlocking();
    patchChannelLock();

    // Register the settings page (see Settings.jsx)
    this.settingsUnpatch = registerSettings("serverguard", Settings);
  },

  onUnload() {
    patches.forEach((p) => p());
    patches.length = 0;
    this.settingsUnpatch?.();
  },
};