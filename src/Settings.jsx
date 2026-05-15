import { storage } from "@vendetta/plugin";
import { findByStoreName } from "@vendetta/metro";
import { Forms, General } from "@vendetta/ui/components";
import { showInputAlert } from "@vendetta/ui/alerts";

const { ScrollView, Text, View, Switch, StyleSheet, TouchableOpacity } =
  window.vendetta.metro.common.ReactNative;
const { React } = window.vendetta.metro.common;

const GuildStore   = findByStoreName("GuildStore");
const ChannelStore = findByStoreName("ChannelStore");

// ─── Simple hash (must match index.js) ───────────────────────
function simpleHash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  }
  return h.toString(16);
}

// ─── Styles ───────────────────────────────────────────────────
const s = StyleSheet.create({
  page:        { flex: 1, backgroundColor: "#1e1f22", padding: 16 },
  section:     { marginBottom: 24 },
  sectionHead: { color: "#80848e", fontSize: 11, fontWeight: "700", letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 8, marginLeft: 4 },
  card:        { backgroundColor: "#2b2d31", borderRadius: 10, overflow: "hidden" },
  row:         { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#3f4147" },
  rowLast:     { borderBottomWidth: 0 },
  avatar:      { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", marginRight: 12 },
  avatarText:  { color: "#fff", fontWeight: "700", fontSize: 14 },
  nameCol:     { flex: 1 },
  name:        { color: "#f2f3f5", fontSize: 15 },
  subtext:     { color: "#80848e", fontSize: 12, marginTop: 1 },
  badge:       { fontSize: 11, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4, overflow: "hidden", marginRight: 8 },
  badgeLocked: { backgroundColor: "#3d1a1a", color: "#ed4245" },
  badgeOpen:   { backgroundColor: "#1a2d1a", color: "#3ba55c" },
  addBtn:      { backgroundColor: "#5865f2", borderRadius: 8, paddingVertical: 10, alignItems: "center", marginTop: 10 },
  addBtnText:  { color: "#fff", fontWeight: "600", fontSize: 14 },
  removeBtn:   { paddingHorizontal: 10, paddingVertical: 4, backgroundColor: "#3d1a1a", borderRadius: 6 },
  removeBtnTxt:{ color: "#ed4245", fontSize: 12 },
});

// ─── Sub-components ───────────────────────────────────────────

/** One row for a guild in the image-block section */
function GuildRow({ guild, isLast }) {
  const [blocked, setBlocked] = React.useState(
    !!storage.imageBlockList[guild.id]
  );

  function toggle(val) {
    setBlocked(val);
    storage.imageBlockList[guild.id] = val;
  }

  const colors = ["#5865f2","#3ba55c","#ed4245","#faa61a","#eb459e"];
  const color  = colors[parseInt(guild.id.slice(-1), 16) % colors.length];

  return React.createElement(
    View, { style: [s.row, isLast && s.rowLast] },
    React.createElement(
      View, { style: [s.avatar, { backgroundColor: color }] },
      React.createElement(Text, { style: s.avatarText }, guild.name[0].toUpperCase())
    ),
    React.createElement(
      View, { style: s.nameCol },
      React.createElement(Text, { style: s.name }, guild.name),
      React.createElement(
        Text, { style: s.subtext },
        blocked ? "Images hidden" : "Images visible"
      )
    ),
    React.createElement(Switch, {
      value: blocked,
      onValueChange: toggle,
      trackColor: { false: "#4f545c", true: "#5865f2" },
    })
  );
}

/** One row for a locked channel */
function ChannelRow({ channelId, isLast, onRemove }) {
  const channel = ChannelStore.getChannel(channelId);
  const name    = channel ? `#${channel.name}` : `#${channelId.slice(0, 8)}`;

  return React.createElement(
    View, { style: [s.row, isLast && s.rowLast] },
    React.createElement(Text, { style: [s.name, { flex: 1 }] }, name),
    React.createElement(
      Text, { style: [s.badge, s.badgeLocked] }, "🔒 locked"
    ),
    React.createElement(
      TouchableOpacity, { style: s.removeBtn, onPress: onRemove },
      React.createElement(Text, { style: s.removeBtnTxt }, "remove")
    )
  );
}

// ─── Main settings component ──────────────────────────────────
export default function Settings() {
  const guilds = React.useMemo(
    () => Object.values(GuildStore.getGuilds()),
    []
  );

  const [lockedChannels, setLockedChannels] = React.useState(
    () => Object.keys(storage.channelLockList).filter(
      (id) => storage.channelLockList[id]
    )
  );

  // Lock a new channel
  async function lockChannel() {
    const channelName = await showInputAlert({
      title: "Lock channel",
      placeholder: "Channel ID or name",
    });
    if (!channelName) return;

    // Try to resolve by name, fall back to treating input as ID
    const all = Object.values(ChannelStore.getMutableGuildChannelsAll?.() ?? {});
    const found = all.find((c) => c.name === channelName.replace(/^#/, ""));
    const id = found?.id ?? channelName;

    const password = await showInputAlert({
      title: "Set password",
      placeholder: "Enter password for this channel",
      secureTextEntry: true,
    });
    if (!password) return;

    storage.channelPasswords[id] = simpleHash(password);
    storage.channelLockList[id]  = true;
    setLockedChannels((prev) => [...prev, id]);
  }

  function removeChannel(id) {
    delete storage.channelPasswords[id];
    delete storage.channelLockList[id];
    setLockedChannels((prev) => prev.filter((c) => c !== id));
  }

  return React.createElement(
    ScrollView, { style: s.page, contentContainerStyle: { paddingBottom: 40 } },

    // ── Section 1: Image blocking ──
    React.createElement(
      View, { style: s.section },
      React.createElement(Text, { style: s.sectionHead }, "Block images per server"),
      React.createElement(
        View, { style: s.card },
        guilds.map((g, i) =>
          React.createElement(GuildRow, {
            key: g.id,
            guild: g,
            isLast: i === guilds.length - 1,
          })
        )
      )
    ),

    // ── Section 2: Channel passwords ──
    React.createElement(
      View, { style: s.section },
      React.createElement(Text, { style: s.sectionHead }, "Password-locked channels"),
      lockedChannels.length > 0 &&
        React.createElement(
          View, { style: [s.card, { marginBottom: 10 }] },
          lockedChannels.map((id, i) =>
            React.createElement(ChannelRow, {
              key: id,
              channelId: id,
              isLast: i === lockedChannels.length - 1,
              onRemove: () => removeChannel(id),
            })
          )
        ),
      React.createElement(
        TouchableOpacity, { style: s.addBtn, onPress: lockChannel },
        React.createElement(Text, { style: s.addBtnText }, "+ Lock a channel")
      )
    )
  );
}