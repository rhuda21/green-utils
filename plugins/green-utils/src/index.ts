import { instead, after } from "@vendetta/patcher";
import { findByProps, findByStoreName, findByName } from "@vendetta/metro";
import { storage } from "@vendetta/plugin";
import { React, ReactNative } from "@vendetta/metro/common";
import Settings from "./Settings";
import MessageHandlers from "./utils/MessageHandlersPatcher";

const { Text, View, TouchableOpacity, StyleSheet, Alert, TextInput, Modal } = ReactNative;

// ─── Storage ────────────────────────────────────────────────────────────────

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

// ─── Discord Modules ─────────────────────────────────────────────────────────

const SelectedGuildStore   = findByStoreName("SelectedGuildStore") || findByProps("getGuildId", "getLastSelectedGuildId");
const SelectedChannelStore = findByStoreName("SelectedChannelStore");
const ThemeStore           = findByStoreName("ThemeStore");
const ChannelView          = findByProps("ChannelChatWrapper") || findByProps("ChannelChat");
const RowManager           = findByName("RowManager");
const getEmbedThemeColors  = findByName("getEmbedThemeColors");
const modals               = findByProps("pushModal");
const CodedLinkExtendedType = findByProps("CodedLinkExtendedType")?.CodedLinkExtendedType ?? { EMBEDDED_ACTIVITY_INVITE: 3 };

// ─── State ───────────────────────────────────────────────────────────────────

const patches: (() => void)[]      = [];
const unlockedGuilds               = new Set<string>();
const unlockedImagesForGuild       = new Set<string>();
const attachmentCache              = new Map<string, any>(); // messageId -> original attachment

// ─── Helpers ─────────────────────────────────────────────────────────────────

function simpleHash(str: string): string {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  }
  return h.toString(16);
}

function getGuildId(): string | null {
  return SelectedGuildStore?.getGuildId?.() || SelectedGuildStore?.getLastSelectedGuildId?.() || null;
}

function getCodedLinkColors() {
  const colors = getEmbedThemeColors?.(ThemeStore?.theme)?.colors || {
    acceptLabelGreenBackgroundColor: -14385083,
    headerColor: -6973533,
    borderColor: 268435455,
    backgroundColor: -14276817,
  };
  return {
    acceptLabelBackgroundColor: colors.acceptLabelGreenBackgroundColor,
    headerColor:                colors.headerColor,
    borderColor:                colors.borderColor,
    backgroundColor:            colors.backgroundColor,
  };
}

function makeRPL(attachment: any, shouldObscure: boolean) {
  return {
    ...getCodedLinkColors(),
    thumbnailCornerRadius:    15,
    headerText:               "",
    titleText:                shouldObscure ? "⚠️ Hidden Media Asset" : `File — ${attachment.size ?? 0}`,
    structurableSubtitleText: null,
    type:                     null,
    extendedType:             CodedLinkExtendedType.EMBEDDED_ACTIVITY_INVITE,
    participantAvatarUris:    [],
    acceptLabelText:          shouldObscure ? "Unlock View" : "Preview",
    splashUrl:                null,
    noParticipantsText:       shouldObscure ? "Content hidden until unlocked" : `\n${attachment.filename ?? "unknown"}`,
    ctaEnabled:               true,
    rawAttachment:            attachment,
  };
}

// ─── Password Modal ───────────────────────────────────────────────────────────

const modalStyles = StyleSheet.create({
  overlay:    { flex: 1, backgroundColor: "rgba(0,0,0,0.7)", justifyContent: "center", alignItems: "center", padding: 20 },
  container:  { backgroundColor: "#313338", borderRadius: 16, padding: 20, width: "100%", maxWidth: 340, borderWidth: 1, borderColor: "#4e5058" },
  title:      { color: "#f2f3f5", fontSize: 18, fontWeight: "700", marginBottom: 8 },
  subtitle:   { color: "#949ba4", fontSize: 13, marginBottom: 16, lineHeight: 18 },
  input:      { backgroundColor: "#1e1f22", borderRadius: 8, padding: 12, color: "#f2f3f5", fontSize: 15, borderWidth: 1, borderColor: "#4e5058", marginBottom: 20 },
  btnRow:     { flexDirection: "row", justifyContent: "flex-end", gap: 12 },
  cancelBtn:  { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 6 },
  cancelText: { color: "#f2f3f5", fontSize: 14, fontWeight: "500" },
  confirmBtn: { backgroundColor: "#5865f2", paddingVertical: 10, paddingHorizontal: 16, borderRadius: 6 },
  confirmTxt: { color: "#fff", fontSize: 14, fontWeight: "600" },
});

function PasswordModal({ guildId, onSuccess }: { guildId: string; onSuccess: () => void }) {
  const [password, setPassword] = React.useState("");

  function handleSubmit() {
    const storedHash = pluginStorage.serverPasswords[guildId];
    if (simpleHash(password ?? "") === storedHash) {
      unlockedImagesForGuild.add(guildId);
      modals.popModal("green-utils-password");
      onSuccess();
    } else {
      Alert.alert("Error", "Invalid Password");
    }
  }

  return React.createElement(
    View, { style: modalStyles.overlay },
    React.createElement(
      View, { style: modalStyles.container },
      React.createElement(Text, { style: modalStyles.title }, "Images Locked"),
      React.createElement(Text, { style: modalStyles.subtitle }, "Enter the server password to view."),
      React.createElement(TextInput, {
        style:              modalStyles.input,
        placeholder:        "Password...",
        placeholderTextColor: "#80848e",
        secureTextEntry:    true,
        value:              password,
        onChangeText:       setPassword,
      }),
      React.createElement(
        View, { style: modalStyles.btnRow },
        React.createElement(
          TouchableOpacity,
          { style: modalStyles.cancelBtn, onPress: () => modals.popModal("green-utils-password") },
          React.createElement(Text, { style: modalStyles.cancelText }, "Cancel")
        ),
        React.createElement(
          TouchableOpacity,
          { style: modalStyles.confirmBtn, onPress: handleSubmit },
          React.createElement(Text, { style: modalStyles.confirmTxt }, "Unlock")
        )
      )
    )
  );
}

function showPasswordPrompt(guildId: string, onSuccess: () => void) {
  modals.pushModal({
    key: "green-utils-password",
    modal: {
      key:                      "green-utils-password",
      modal:                    PasswordModal,
      props:                    { guildId, onSuccess },
      animation:                "slide-up",
      shouldPersistUnderModals: false,
      closable:                 true,
    },
  });
}

// ─── Lock Screen ──────────────────────────────────────────────────────────────

const lockStyles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#313338", padding: 24 },
  icon:      { fontSize: 56, marginBottom: 16 },
  title:     { color: "#f2f3f5", fontSize: 20, fontWeight: "700", marginBottom: 8 },
  subtitle:  { color: "#80848e", fontSize: 14, marginBottom: 32, textAlign: "center" },
  btn:       { backgroundColor: "#5865f2", paddingHorizontal: 32, paddingVertical: 14, borderRadius: 8, width: "100%", alignItems: "center" },
  btnText:   { color: "#fff", fontSize: 16, fontWeight: "600" },
});

function LockScreen({ guildId, onUnlockCompleted }: { guildId: string; onUnlockCompleted: () => void }) {
  return React.createElement(
    View, { style: lockStyles.container },
    React.createElement(Text, { style: lockStyles.icon }, "🔒"),
    React.createElement(Text, { style: lockStyles.title }, "Server Locked"),
    React.createElement(Text, { style: lockStyles.subtitle }, "This server is locked behind a password."),
    React.createElement(
      TouchableOpacity,
      { style: lockStyles.btn, onPress: () => showPasswordPrompt(guildId, onUnlockCompleted) },
      React.createElement(Text, { style: lockStyles.btnText }, "Enter Password")
    )
  );
}

// ─── Tap Handler ─────────────────────────────────────────────────────────────

function handleInviteFileAction(args: any[], originalFunction: Function) {
  const guildId = getGuildId();
  const nativeEvent = args?.[0]?.nativeEvent ?? args?.[0];

  const shouldPrompt =
    !!guildId &&
    !!pluginStorage.imageBlockList[guildId] &&
    !!pluginStorage.imageLockRequirePassword &&
    !unlockedImagesForGuild.has(guildId);

  if (shouldPrompt) {
    showPasswordPrompt(guildId!, () => {
      // Force Discord to re-render the message list so RowManager
      // runs again — this time unlockedImagesForGuild has the guild
      // so attachments render normally instead of as RPLs
      const FluxDispatcher = findByProps("dispatch", "subscribe");
      FluxDispatcher?.dispatch({ type: "INVALIDATE_ROWS" });

      // Fallback: try dispatching a channel select to force a full re-render
      const channelId = SelectedChannelStore?.getChannelId?.();
      if (channelId) {
        FluxDispatcher?.dispatch({
          type: "CHANNEL_SELECT",
          channelId,
        });
      }
    });
    return null;
  }

  return originalFunction(...args);
}

// ─── Patches ─────────────────────────────────────────────────────────────────

function patchMessageHandlers(): void {
  // Force MessagesHandlers to instantiate so pending patches apply immediately
  try {
    const { MessagesHandlers } = findByProps("MessagesHandlers");
    const temp = new MessagesHandlers();
    void temp?.params;
  } catch (_) {}

  patches.push(
    MessageHandlers.patchInstead("handleTapInviteEmbed",       handleInviteFileAction),
    MessageHandlers.patchInstead("handleTapInviteEmbedAccept", handleInviteFileAction),
  );
}

function patchRowManager(): void {
  if (!RowManager?.prototype) return;

  patches.push(
    after("generate", RowManager.prototype, (_, row) => {
      const { message } = row;
      if (!message?.attachments?.length) return;

      // Use the guildId from the channel the message belongs to, not the selected guild
      const ChannelStore = findByStoreName("ChannelStore");
      const channel = ChannelStore?.getChannel?.(message.channel_id);
      const guildId = channel?.guild_id;

      // Only obscure if this message actually belongs to a blocked guild
      if (!guildId || !pluginStorage.imageBlockList[guildId]) return;

      const shouldObscure =
        !pluginStorage.imageLockRequirePassword ||
        !unlockedImagesForGuild.has(guildId);

      message.attachments.forEach((att: any) => {
        attachmentCache.set(message.id, att);
      });

      const rpls = message.attachments.map((att: any) => makeRPL(att, shouldObscure));

      if (rpls.length) {
        message.codedLinks = [...(message.codedLinks ?? []), ...rpls];
        message.attachments = [];
      }
    })
  );
}

function patchChannelView(): void {
  if (!ChannelView) return;
  const targetMethod = "ChannelChatWrapper" in ChannelView ? "ChannelChatWrapper" : "default";

  patches.push(
    instead(targetMethod, ChannelView, (args: any[], orig: Function) => {
      const guildId = getGuildId();

      if (guildId && pluginStorage.serverLockList[guildId] && !unlockedGuilds.has(guildId)) {
        return React.createElement(LockScreen, {
          guildId,
          onUnlockCompleted: () => {
            unlockedGuilds.add(guildId);
          },
        });
      }

      return orig(...args);
    })
  );
}

// ─── Plugin Entry ─────────────────────────────────────────────────────────────

export default {
  settings: Settings,

  onLoad() {
    setTimeout(() => {
      try {
        patchMessageHandlers();
        patchRowManager();
        patchChannelView();
      } catch (e) {
        console.error("[green-utils] onLoad error:", e);
      }
    }, 1000);
  },

  onUnload() {
    patches.forEach((u) => typeof u === "function" && u());
    patches.length = 0;
    unlockedGuilds.clear();
    unlockedImagesForGuild.clear();
    attachmentCache.clear();
    MessageHandlers.unpatch(MessageHandlers.UnpatchALL);
  },
};