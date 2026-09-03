import type { APIEmbed, ChatInputCommandInteraction, ButtonInteraction } from 'discord.js';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  ApplicationCommandOptionType,
} from 'discord.js';
import { ButtonComponent, Discord, Slash, SlashOption } from 'discordx';
import { summarizeChannel } from '../llm/summarize.js';
import { collectImagesFromMessages, modelSupportsVision } from '../llm/vision.js';
import { isDenylistedWithAncestors } from '../llm/tools.js';
import { formatMessageLine } from '../history.js';
import { loadConfig } from '../config.js';
import { createLogger } from '../logger.js';

const log = createLogger('summarize');

const DEFAULT_COUNT = 50;
const MAX_COUNT = 200;
const DESCRIPTION_LIMIT = 4096;
const FIELD_LIMIT = 1024;
const EMBED_TOTAL_LIMIT = 6000;
const MAX_FIELDS = 25;
const PUBLISH_BUTTON = 'summary:publish';

function addOverflowFields(embed: EmbedBuilder, summary: string, title: string): void {
  // Overhead: title + timestamp + field names + slack.
  let budget = EMBED_TOTAL_LIMIT - Math.min(summary.length, DESCRIPTION_LIMIT) - title.length - 60;
  let remaining = summary.slice(DESCRIPTION_LIMIT);
  while (remaining.length > 0 && budget > 0 && embed.data.fields!.length < MAX_FIELDS) {
    const size = Math.min(remaining.length, FIELD_LIMIT, budget);
    embed.addFields({ name: '_ _', value: remaining.slice(0, size), inline: false });
    remaining = remaining.slice(size);
    budget -= size;
  }
  if (remaining.length > 0) {
    log.warn({ dropped: remaining.length }, 'Summary exceeded embed capacity; tail dropped');
  }
}

export function buildSummaryEmbed(summary: string, channelName: string): EmbedBuilder {
  const title = `Summary of #${channelName}`;
  const embed = new EmbedBuilder().setTitle(title).setDescription(summary.slice(0, DESCRIPTION_LIMIT)).setTimestamp();
  embed.data.fields = [];
  addOverflowFields(embed, summary, title);
  return embed;
}

export function extractSummary(data: APIEmbed): string {
  return [data.description ?? '', ...(data.fields ?? []).filter((f) => f.name === '_ _').map((f) => f.value)].join('');
}

@Discord()
export class SummarizeCommand {
  @Slash({ name: 'summarize', description: 'Summarize recent messages in this channel (in English)' })
  async summarize(
    @SlashOption({
      name: 'count',
      description: `How many recent messages to summarize (default ${DEFAULT_COUNT}, max ${MAX_COUNT})`,
      type: ApplicationCommandOptionType.Integer,
      required: false,
    })
    count: number | undefined,
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (!interaction.guildId) {
      await interaction.editReply('This command only works in a server.');
      return;
    }
    const channel = await interaction.channel?.fetch().catch(() => null);
    if (!channel || !channel.isTextBased()) {
      await interaction.editReply('This command must be used in a text channel.');
      return;
    }
    if (await isDenylistedWithAncestors(interaction.client, interaction.guildId, channel.id)) {
      await interaction.editReply('This channel is excluded from summarization.');
      return;
    }

    const limit = Math.min(Math.max(1, count ?? DEFAULT_COUNT), MAX_COUNT);
    const fetched = await channel.messages.fetch({ limit }).catch((err) => {
      log.error({ err }, 'Failed to fetch channel history');
      return null;
    });
    if (!fetched) {
      await interaction.editReply('Could not read this channel\'s history.');
      return;
    }
    const messages = [...fetched.values()].reverse();
    const chatContext = messages.map(formatMessageLine).join('\n');

    const typing = setInterval(() => {
      if (channel.isTextBased() && 'sendTyping' in channel) void channel.sendTyping().catch(() => {});
    }, 8_000);

    try {
      const { openaiEndpoint, openaiApiKey, openaiModel, openaiVision } = loadConfig();
      const vision = await modelSupportsVision(openaiEndpoint, openaiApiKey, openaiModel, openaiVision);
      const images = await collectImagesFromMessages(messages, vision);
      if (!chatContext.trim() && images.length === 0) {
        await interaction.editReply('There is nothing here to summarize.');
        return;
      }

      const summary = await summarizeChannel(
        channel.isDMBased() ? 'dm' : channel.name,
        chatContext,
        images,
        interaction.client,
        { guildId: interaction.guildId, userId: interaction.user.id },
      );

      const embed = buildSummaryEmbed(summary, channel.isDMBased() ? 'dm' : channel.name);
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(PUBLISH_BUTTON).setLabel('Make it public').setStyle(ButtonStyle.Primary),
      );
      await interaction.editReply({ embeds: [embed], components: [row] });
    } catch (err) {
      log.error({ err }, 'Summarize failed');
      await interaction.editReply('The summary drifted into a black hole. Try again shortly. 🐸').catch(() => {});
    } finally {
      clearInterval(typing);
    }
  }

  @ButtonComponent({ id: PUBLISH_BUTTON })
  async publish(interaction: ButtonInteraction): Promise<void> {
    // The ephemeral message itself carries the summary; no server-side state needed.
    const data = interaction.message.embeds[0]?.data;
    if (!data) {
      await interaction.reply({ content: 'Could not find the summary on this message.', flags: MessageFlags.Ephemeral });
      return;
    }
    const title = data.title ?? 'Summary';
    const summary = extractSummary(data);
    const published = new EmbedBuilder().setTitle(title).setDescription(summary.slice(0, DESCRIPTION_LIMIT)).setTimestamp();
    published.data.fields = [];
    addOverflowFields(published, summary, title);
    if (interaction.channel?.isSendable()) {
      await interaction.channel.send({ embeds: [published] });
      // Stale ephemerals keep the button; blank it so old summaries can't be re-published.
      await interaction.update({ components: [] });
    } else {
      await interaction.reply({ content: 'Cannot send in this channel.', flags: MessageFlags.Ephemeral });
    }
  }
}
