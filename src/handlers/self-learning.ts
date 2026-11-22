import {
  ActionRowBuilder,
  ApplicationCommandType,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  LabelBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Message,
  type MessageContextMenuCommandInteraction,
  type ModalSubmitInteraction,
} from 'discord.js';
import { ButtonComponent, ContextMenu, Discord, ModalComponent, Slash, SlashGroup } from 'discordx';
import { isUserDenylisted, loadConfig } from '../config.js';
import { formatMessageLine } from '../history.js';
import { rewriteWithCorrection } from '../llm/corrections.js';
import { createLogger } from '../logger.js';
import { buildExport } from '../self-learning/export.js';
import { appendEntry, clearEntriesUpTo, readEntries } from '../self-learning/store.js';

const log = createLogger('self-learning');
const CORRECT_MODAL_PREFIX = 'correct-rebecca:';
const CORRECTION_FIELD = 'correction';
const REWRITE_CONTEXT_MESSAGES = 15;
const CLEAR_BUTTON_PREFIX = 'self-learning:clear:';
const KEEP_BUTTON = 'self-learning:keep';

@Discord()
export class CorrectRebecca {
  @ContextMenu({
    name: 'Correct Rebecca',
    type: ApplicationCommandType.Message,
    defaultMemberPermissions: PermissionFlagsBits.Administrator,
    dmPermission: false,
  })
  async open(interaction: MessageContextMenuCommandInteraction): Promise<void> {
    const target = interaction.targetMessage;
    if (target.author.id !== interaction.client.user.id) {
      await interaction.reply({ content: 'This only works on Rebecca\'s messages.', flags: MessageFlags.Ephemeral });
      return;
    }
    const input = new TextInputBuilder()
      .setCustomId(CORRECTION_FIELD)
      .setStyle(TextInputStyle.Paragraph)
      .setMaxLength(1000)
      .setRequired(true);
    const modal = new ModalBuilder()
      .setCustomId(`${CORRECT_MODAL_PREFIX}${target.channelId}:${target.id}`)
      .setTitle('Correct Rebecca')
      .addLabelComponents(new LabelBuilder().setLabel('What should she have said?').setTextInputComponent(input));
    await interaction.showModal(modal);
  }

  @ModalComponent({ id: /^correct-rebecca:/ })
  async submit(interaction: ModalSubmitInteraction): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const [channelId, messageId] = interaction.customId.slice(CORRECT_MODAL_PREFIX.length).split(':');
    const correction = interaction.fields.getTextInputValue(CORRECTION_FIELD).trim();
    const channel = await interaction.client.channels.fetch(channelId).catch(() => null);
    const message = channel?.isTextBased() ? await channel.messages.fetch(messageId).catch(() => null) : null;
    if (!message || !interaction.guildId || message.author.id !== interaction.client.user.id) {
      await interaction.editReply('Could not find that Rebecca message anymore.');
      return;
    }
    const original = message.content;
    const conversation = await conversationBefore(message);

    let rewritten: string | null = null;
    try {
      rewritten = await rewriteWithCorrection(original, correction, conversation);
      await message.edit({ content: rewritten, allowedMentions: { parse: [] } });
    } catch (err) {
      log.error({ err, messageId }, 'Failed to rewrite corrected message');
      rewritten = null;
    }
    try {
      await appendEntry({
        kind: 'admin-correction',
        guildId: interaction.guildId,
        channelId,
        messageId,
        correctorId: interaction.user.id,
        original,
        correction,
        rewritten,
      });
    } catch (err) {
      log.error({ err, messageId }, 'Failed to save admin correction');
      await interaction.editReply(rewritten ? 'Rewrote the message, but saving the correction for review failed (storage error).' : 'Both the rewrite and saving the correction failed. You may want to delete the message.');
      return;
    }
    log.info({ messageId, correctorId: interaction.user.id, rewritten: rewritten !== null }, 'Admin correction saved');
    await interaction.editReply(
      rewritten
        ? `Saved for review and the message now reads:\n>>> ${rewritten}`
        : 'Saved for review, but rewriting the message failed. You may want to delete it.',
    );
  }
}

async function conversationBefore(message: Message): Promise<string> {
  const before = await message.channel.messages
    .fetch({ before: message.id, limit: REWRITE_CONTEXT_MESSAGES })
    .catch(() => null);
  const lines = [...(before?.values() ?? [])]
    .reverse()
    .filter((m) => !isUserDenylisted(m.author.id))
    .map(formatMessageLine);
  const answered = message.reference?.messageId ? await message.fetchReference().catch(() => null) : null;
  if (answered && !isUserDenylisted(answered.author.id)) {
    lines.push(`(the message you were replying to) ${formatMessageLine(answered)}`);
  }
  return lines.join('\n');
}

@Discord()
@SlashGroup({
  name: 'self-learning',
  description: 'Review what Rebecca has collected for her maintainers',
  defaultMemberPermissions: PermissionFlagsBits.Administrator,
  dmPermission: false,
})
@SlashGroup('self-learning')
export class SelfLearningCommand {
  @Slash({ name: 'get', description: 'Download the collected corrections and feedback as a review prompt' })
  async get(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const entries = await readEntries().catch((err) => {
      log.error({ err }, 'Failed to read self-learning collection');
      return null;
    });
    if (!entries) {
      await interaction.editReply('Could not read the collection (storage error).');
      return;
    }
    const cutoff = entries.reduce((latest, e) => Math.max(latest, Date.parse(e.at)), 0);
    if (entries.length === 0) {
      await interaction.editReply('Nothing has been collected yet.');
      return;
    }
    const file = new AttachmentBuilder(Buffer.from(buildExport(entries), 'utf8'), {
      name: `rebecca-self-learning-${new Date().toISOString().slice(0, 10)}.txt`,
    });
    const isMaintainer = loadConfig().botMaintainerIds.includes(interaction.user.id);
    const components = isMaintainer
      ? [
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId(`${CLEAR_BUTTON_PREFIX}${cutoff}`).setLabel('Clear collected feedback').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId(KEEP_BUTTON).setLabel('Keep').setStyle(ButtonStyle.Secondary),
          ),
        ]
      : [];
    await interaction.editReply({ content: `${entries.length} entries collected.`, files: [file], components });
  }

  @ButtonComponent({ id: /^self-learning:clear:\d+$/ })
  async clear(interaction: ButtonInteraction): Promise<void> {
    if (!loadConfig().botMaintainerIds.includes(interaction.user.id)) {
      await interaction.reply({ content: 'Only bot maintainers can clear this.', flags: MessageFlags.Ephemeral });
      return;
    }
    const cutoff = new Date(Number(interaction.customId.slice(CLEAR_BUTTON_PREFIX.length)));
    const remaining = await clearEntriesUpTo(cutoff).catch((err) => {
      log.error({ err }, 'Failed to clear self-learning collection');
      return null;
    });
    if (remaining === null) {
      await interaction.update({ content: 'Clearing failed (storage error); nothing was removed.', components: [] });
      return;
    }
    log.info({ by: interaction.user.id, remaining }, 'Self-learning collection cleared');
    const note = remaining > 0 ? ` ${remaining} newer entries arrived since this export and were kept.` : '';
    await interaction.update({ content: `Cleared. The file above is the only copy now.${note}`, components: [] });
  }

  @ButtonComponent({ id: KEEP_BUTTON })
  async keep(interaction: ButtonInteraction): Promise<void> {
    await interaction.update({ content: 'Kept as is.', components: [] });
  }
}
