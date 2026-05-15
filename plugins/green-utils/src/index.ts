import { instead, after } from "@vendetta/patcher";
import { findByProps, findByStoreName, findByName } from "@vendetta/metro";
import { storage } from "@vendetta/plugin";
import { React, ReactNative } from "@vendetta/metro/common";
import Settings from "./Settings";
import MessageHandlers from "./utils/MessageHandlersPatcher";

const { Text, View, TouchableOpacity, StyleSheet, Alert } = ReactNative;

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

// Discord Core Stores
const SelectedGuildStore = findByStoreName("SelectedGuildStore") || findByProps("getGuildId", "getLastSelectedGuildId");
const ThemeStore = findByStoreName("ThemeStore");

// Discord Core Modules & View Components
const ChannelView = findByProps("ChannelChatWrapper") || findByProps("ChannelChat");
const alertModule = findByProps("showInputAlert");
const RowManager = findByName("RowManager");
const getEmbedThemeColors = findByName("getEmbedThemeColors");
const CodedLinkExtendedType = findByProps("CodedLinkExtendedType")?.CodedLinkExtendedType ?? { EMBEDDED_ACTIVITY_INVITE: 3 };

const patches: (() => void)[] = [];
const unlockedGuilds = new Set<string>();
const unlockedImagesForGuild = new Set<string>();

function simpleHash(str: string): string {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  }
  return h.toString(16);
}

function getCodedLinkColors() {
  let colors = getEmbedThemeColors?.(ThemeStore.theme)?.colors || {
    acceptLabelGreenBackgroundColor: -14385083,
    headerColor: -6973533,
    borderColor: 268435455,
    backgroundColor: -14276817,
  };
  return {
    acceptLabelBackgroundColor: colors.acceptLabelGreenBackgroundColor,
    headerColor: colors.headerColor,
    borderColor: colors.borderColor,
    backgroundColor: colors.backgroundColor,
  };
}

function makeRPL(attachment, shouldObscure: boolean) {
  const filename = attachment.filename ?? "unknown";
  const size = attachment.size ?? 0;

  const displayTitle = shouldObscure ? "⚠️ Hidden Media Asset" : "File" + " — " + size;
  const displayFilename = shouldObscure ? "Content hidden until unlocked" : "\n" + filename;
  const buttonText = shouldObscure ? "Unlock View" : "Preview";

  return {
    ...getCodedLinkColors(),
    thumbnailCornerRadius: 15,
    headerText: "",
    titleText: displayTitle,
    structurableSubtitleText: null,
    type: null,
    extendedType: CodedLinkExtendedType.EMBEDDED_ACTIVITY_INVITE,
    participantAvatarUris: [],
    acceptLabelText: buttonText,
    splashUrl: null,
    noParticipantsText: displayFilename,
    ctaEnabled: true,
    // Keep a secure backup of the original attachment data inside the layout item
    rawAttachment: attachment
  };
}

function handleInviteFileAction(args, originalFunction) {
  const guildId = SelectedGuildStore?.getGuildId?.() || SelectedGuildStore?.getLastSelectedGuildId?.();
  
  const executeOriginal = () => {
    // Reconstruct attachment layout context if RowManager cleared it out
    const nativeEvent = args[0]?.nativeEvent ?? args[0];
    if (nativeEvent && !nativeEvent.message?.attachments?.length) {
      const codedLink = nativeEvent.codedLink;
      if (codedLink?.rawAttachment) {
        nativeEvent.message ??= {};
        nativeEvent.message.attachments = [codedLink.rawAttachment];
      }
    }
    return originalFunction(...args);
  };

  if (guildId && pluginStorage.imageBlockList[guildId] && pluginStorage.imageLockRequirePassword && !unlockedImagesForGuild.has(guildId)) {
    const storedHash = pluginStorage.serverPasswords[guildId];
    const customAlert = alertModule?.showInputAlert;

    if (storedHash && customAlert) {
      customAlert({
        title: "Images Locked",
        placeholder: "Enter password to view...",
        secureTextEntry: true,
        confirmText: "Unlock",
        cancelText: "Cancel",
        onConfirm: (input: string) => {
          if (simpleHash(input ?? "") === storedHash) {
            unlockedImagesForGuild.add(guildId);
            executeOriginal();
          } else {
            Alert.alert("Error", "Invalid Password");
          }
        }
      });
      return null;
    }
  }

  return executeOriginal();
}

function patchMessageHandlers(): void {
  const unpatchTap = MessageHandlers.patchInstead("handleTapInviteEmbed", handleInviteFileAction);
  const unpatchAccept = MessageHandlers.patchInstead("handleTapInviteEmbedAccept", handleInviteFileAction);
  patches.push(unpatchTap, unpatchAccept);
}

function patchRowManager(): void {
  if (!RowManager?.prototype) return;
  
  const unpatchRow = after("generate", RowManager.prototype, (_, row) => {
    const { message } = row;
    if (!message?.attachments?.length) return;

    const guildId = SelectedGuildStore?.getGuildId?.() || SelectedGuildStore?.getLastSelectedGuildId?.();
    let shouldObscure = false;

    if (guildId && pluginStorage.imageBlockList[guildId]) {
      if (!pluginStorage.imageLockRequirePassword || !unlockedImagesForGuild.has(guildId)) {
        shouldObscure = true;
      }
    }

    let rpls: any[] = [];
    
    message.attachments.forEach((attachment) => {
      rpls.push(makeRPL(attachment, shouldObscure));
    });

    if (rpls.length) {
      if (!message.codedLinks?.length) message.codedLinks = [];
      message.codedLinks.push(...rpls);
      message.attachments = []; 
    }
  });
  patches.push(unpatchRow);
}

function initializeChannelLockPatch(): void {
  if (!ChannelView) return;
  const targetMethod = "ChannelChatWrapper" in ChannelView ? "ChannelChatWrapper" : "default";

  const unpatchLock = instead(targetMethod, ChannelView, (args: any[], orig: Function) => {
    const currentGuildId = SelectedGuildStore?.getGuildId?.() || SelectedGuildStore?.getLastSelectedGuildId?.();

    if (currentGuildId && pluginStorage.serverLockList[currentGuildId] && !unlockedGuilds.has(currentGuildId)) {
      return React.createElement(LockScreen, {
        guildId: currentGuildId,
        onUnlockCompleted: () => {
          unlockedGuilds.add(currentGuildId);
          forceUpdateChat();
        }
      });
    }

    return orig(...args);
  });
  patches.push(unpatchLock);
}

let forceUpdateChat = () => {};

function LockScreen({ guildId, onUnlockCompleted }: any) {
  const [, forceComponentUpdate] = React.useReducer((x) => x + 1, 0);
  
  React.useEffect(() => {
    forceUpdateChat = forceComponentUpdate;
  }, []);

  const styles = StyleSheet.create({
    container: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#313338", padding: 24 },
    icon:      { fontSize: 56, marginBottom: 16 },
    title:     { color: "#f2f3f5", fontSize: 20, fontWeight: "700", marginBottom: 8 },
    subtitle:  { color: "#80848e", fontSize: 14, marginBottom: 32, textAlign: "center" },
    btn:       { backgroundColor: "#5865f2", paddingHorizontal: 32, paddingVertical: 14, borderRadius: 8, width: "100%", alignItems: "center" },
    btnText:   { color: "#fff", fontSize: 16, fontWeight: "600" },
  });

  function handleUnlock() {
    const storedHash = pluginStorage.serverPasswords[guildId];
    const alertPrompt = alertModule?.showInputAlert;
    
    if (alertPrompt) {
      alertPrompt({
        title: "Server Locked",
        placeholder: "Enter password...",
        secureTextEntry: true,
        confirmText: "Unlock",
        cancelText: "Cancel",
        onConfirm: (input: string) => {
          if (simpleHash(input ?? "") === storedHash) {
            onUnlockCompleted();
          } else {
            Alert.alert("Error", "Invalid Password");
          }
        }
      });
    } else {
      Alert.alert("Error", "Secure overlay module missing.");
    }
  }

  return React.createElement(
    View, { style: styles.container },
    React.createElement(Text, { style: styles.icon }, "🔒"),
    React.createElement(Text, { style: styles.title }, "Server Locked"),
    React.createElement(Text, { style: styles.subtitle }, "This server is locked behind a password."),
    React.createElement(
      TouchableOpacity, { style: styles.btn, onPress: handleUnlock },
      React.createElement(Text, { style: styles.btnText }, "Enter Password")
    )
  );
}

export default {
  settings: Settings,

  onLoad() {
    setTimeout(() => {
      try {
        patchMessageHandlers();
        patchRowManager();
        initializeChannelLockPatch();
      } catch (e) {
        console.error(e);
      }
    }, 1000);
  },

  onUnload() {
    patches.forEach((unpatch) => {
      if (typeof unpatch === "function") unpatch();
    });
    patches.length = 0;
    unlockedGuilds.clear();
    unlockedImagesForGuild.clear();
    MessageHandlers.unpatch(MessageHandlers.UnpatchALL);
  },
};