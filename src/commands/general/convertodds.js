const { SlashCommandBuilder } = require('discord.js');
const { americanToDecimal, decimalToAmerican, formatOdds } = require('../../utils/odds');

const command = new SlashCommandBuilder()
  .setName('convertodds')
  .setDescription('Convert between American and Decimal odds')
  .addStringOption(option =>
    option.setName('format')
      .setDescription('Input format')
      .setRequired(true)
      .addChoices(
        { name: 'American → Decimal', value: 'american' },
        { name: 'Decimal → American', value: 'decimal' },
      )
  )
  .addNumberOption(option =>
    option.setName('odds')
      .setDescription('The odds value to convert')
      .setRequired(true)
  );

async function execute(interaction) {
  const format = interaction.options.getString('format');
  const odds = interaction.options.getNumber('odds');

  if (format === 'american') {
    const decimal = americanToDecimal(odds);
    await interaction.reply({
      content: `🔄 **${formatOdds(odds)}** (American) = **${decimal}** (Decimal)`,
      ephemeral: true,
    });
  } else {
    const american = decimalToAmerican(odds);
    await interaction.reply({
      content: `🔄 **${odds}** (Decimal) = **${formatOdds(american)}** (American)`,
      ephemeral: true,
    });
  }
}

module.exports = {
  command,
  execute,
};
