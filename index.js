// --- Main Application File for Rishu Referral Contest Bot ---

// 1. Import necessary libraries
require('dotenv').config(); // Loads environment variables from a .env file
const TelegramBot = require('node-telegram-bot-api');
const { Pool } = require('pg'); // PostgreSQL client

// 2. Get secrets from environment variables
const token = process.env.TELEGRAM_BOT_TOKEN;
const databaseUrl = process.env.DATABASE_URL;
const groupChatId = process.env.GROUP_CHAT_ID; // Your numeric Telegram Group Chat ID
const botUsername = process.env.BOT_USERNAME; // Your bot's username without the '@'

// Basic validation to ensure environment variables are set
if (!token || !databaseUrl || !groupChatId || !botUsername) {
    console.error('CRITICAL ERROR: Make sure TELEGRAM_BOT_TOKEN, DATABASE_URL, GROUP_CHAT_ID, and BOT_USERNAME are set in your .env file.');
    process.exit(1);
}

// 3. Initialize the Bot and Database
const bot = new TelegramBot(token, { polling: true });
const pool = new Pool({
    connectionString: databaseUrl,
    // Required for connecting to cloud databases like on Render
    ssl: {
        rejectUnauthorized: false
    }
});

console.log('Bot has been started...');

// --- Database Helper Functions ---

/**
 * Gets a user from the database or creates a new one if they don't exist.
 * @param {number} telegramId - The user's Telegram ID.
 * @param {string} username - The user's Telegram username.
 * @param {string} firstName - The user's first name.
 * @returns {Promise<object>} The user's data from the database.
 */
async function getOrCreateUser(telegramId, username, firstName) {
    const client = await pool.connect();
    try {
        // Check if user exists
        let res = await client.query('SELECT * FROM users WHERE telegram_id = $1', [telegramId]);
        if (res.rows.length === 0) {
            // If not, create them
            res = await client.query(
                'INSERT INTO users (telegram_id, username, first_name) VALUES ($1, $2, $3) RETURNING *',
                [telegramId, username, firstName]
            );
            console.log(`New user created: ${firstName} (${telegramId})`);
        }
        return res.rows[0];
    } finally {
        client.release();
    }
}

// --- Bot Command Handlers ---

// Handler for the /start command
bot.onText(/\/start(?: (.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const username = msg.from.username;
    const firstName = msg.from.first_name;
    const newReferrerId = match ? match[1] : null; // The referrer's ID, if present

    try {
        // Ensure the user is in our database
        await getOrCreateUser(userId, username, firstName);

        // Case 1: The user was referred by someone
        if (newReferrerId && Number(newReferrerId) !== userId) {
            const client = await pool.connect();
            try {
                // Check if this user was already referred
                const existingReferralRes = await client.query('SELECT * FROM referrals WHERE referred_id = $1', [userId]);
                const existingReferral = existingReferralRes.rows[0];

                // Logic to generate a one-time use invite link
                const generateInviteLink = async () => {
                     try {
                        const inviteLink = await bot.createChatInviteLink(groupChatId, {
                            member_limit: 1,
                            name: `Referral for ${firstName}`
                        });
                        bot.sendMessage(chatId, `Here is your personal one-time link to the group: ${inviteLink.invite_link}`);
                    } catch (e) {
                        console.error("Failed to create invite link. Is the bot an admin with invite permissions?", e);
                        bot.sendMessage(chatId, "Sorry, I couldn't generate an invite link right now. Please contact an admin.");
                    }
                };

                if (!existingReferral) {
                    // This is a completely new referral
                    await client.query('INSERT INTO referrals (referrer_id, referred_id) VALUES ($1, $2)', [newReferrerId, userId]);
                    bot.sendMessage(chatId, `Welcome, ${firstName}! You were referred. Please join our group to complete the referral.`);
                    await generateInviteLink();
                    bot.sendMessage(newReferrerId, `🎉 Great news! ${firstName} has used your referral link. You'll get your point once they join the group.`).catch(err => console.log(`Could not notify referrer ${newReferrerId}, maybe they blocked the bot.`));
                } else if (existingReferral && !existingReferral.is_active) {
                    // User exists but left the group. We can re-assign them to a new referrer.
                    await client.query('UPDATE referrals SET referrer_id = $1 WHERE referred_id = $2', [newReferrerId, userId]);
                    bot.sendMessage(chatId, `Welcome back, ${firstName}! You are being referred by a new user. Please join the group to complete the referral.`);
                    await generateInviteLink();
                    bot.sendMessage(newReferrerId, `🎉 Great news! ${firstName} (a returning user) has used your referral link. You'll get your point once they join the group.`).catch(err => console.log(`Could not notify referrer ${newReferrerId}, maybe they blocked the bot.`));
                } else {
                    // User is already an active member referred by someone else.
                    bot.sendMessage(chatId, `Welcome back, ${firstName}! It looks like you are already an active member of our group.`);
                }
            } finally {
                client.release();
            }

        } else {
            // Case 2: A regular /start command, not a referral
            const welcomeMessage = `🚀 Welcome to the Rishu Referral Race!\n\nWhere meme lovers and traders battle for glory — and real rewards. 💰\n🔥 Here’s what’s up:\n\nInvite your friends to join the Rishu Telegram community and climb the leaderboard.\n\nTop referrers win:\n\n🥇 $100\n🥈 $60\n🥉 $40\n\n👉 Tap “Get My Referral Link” to start earning points.\n\nYou can also check your rank, see the leaderboard, and stay tuned for Rishu updates & meme coin alpha.\nLet’s make Rishu go viral. The more you invite, the higher you rise. 🌕\n\n#RishuArmy | #RishuCoin | #ReferralRace`;

            const options = {
                reply_markup: {
                    keyboard: [
                        [{ text: '🔗 Get My Referral Link' }],
                        [{ text: '🏆 My Rank' }, { text: '📈 Top 10 Leaderboard' }]
                    ],
                    resize_keyboard: true,
                    one_time_keyboard: false
                }
            };

            bot.sendMessage(chatId, welcomeMessage, options);
        }
    } catch (error) {
        console.error('Error in /start handler:', error);
        bot.sendMessage(chatId, 'Sorry, something went wrong. Please try again later.');
    }
});

// Handler for the /mylink command and the "Get My Referral Link" button
bot.onText(/\/mylink|🔗 Get My Referral Link/, (msg) => {
    const chatId = msg.chat.id;
    const referralLink = `https://t.me/${botUsername}?start=${chatId}`;
    bot.sendMessage(chatId, `Here is your unique referral link:\n${referralLink}`);
});


// Handler for the /rank command and "My Rank" button
bot.onText(/\/rank|🏆 My Rank/, async (msg) => {
    const chatId = msg.chat.id;
    try {
        // The subquery calculates the rank by counting how many users have more referrals
        const rankQuery = `
            WITH user_rank AS (
                SELECT telegram_id, referral_count, RANK() OVER (ORDER BY referral_count DESC) as position
                FROM users
            )
            SELECT position, referral_count FROM user_rank WHERE telegram_id = $1;
        `;
        const res = await pool.query(rankQuery, [chatId]);

        if (res.rows.length > 0 && res.rows[0].referral_count > 0) {
            const { position, referral_count } = res.rows[0];
            bot.sendMessage(chatId, `You have **${referral_count}** referrals.\nYour current rank is **${position}**!`);
        } else {
            bot.sendMessage(chatId, "You haven't referred anyone yet. Use your referral link to get started!");
        }
    } catch (error) {
        console.error('Error in /rank handler:', error);
        bot.sendMessage(chatId, 'Could not retrieve your rank. Please try again.');
    }
});


// Handler for the /top10 command and "Top 10 Leaderboard" button
bot.onText(/\/top10|📈 Top 10 Leaderboard/, async (msg) => {
    const chatId = msg.chat.id;

    // Admin check for groups
    if (msg.chat.type === 'group' || msg.chat.type === 'supergroup') {
        try {
            const chatMember = await bot.getChatMember(chatId, msg.from.id);
            if (!['creator', 'administrator'].includes(chatMember.status)) {
                // Silently ignore non-admins in groups
                return;
            }
        } catch (error) {
            console.error("Error checking admin status:", error);
            return;
        }
    }

    try {
        const res = await pool.query(
            'SELECT first_name, username, referral_count FROM users WHERE referral_count > 0 ORDER BY referral_count DESC LIMIT 10'
        );

        if (res.rows.length === 0) {
            bot.sendMessage(chatId, 'The leaderboard is empty. No one has any referrals yet!');
            return;
        }

        let leaderboardText = '🏆 **Top 10 Referrers** 🏆\n\n';
        res.rows.forEach((row, index) => {
            const name = row.username ? `@${row.username}` : row.first_name;
            leaderboardText += `${index + 1}. ${name} - ${row.referral_count} referrals\n`;
        });

        bot.sendMessage(chatId, leaderboardText);
    } catch (error) {
        console.error('Error in /top10 handler:', error);
        bot.sendMessage(chatId, 'Could not retrieve the leaderboard. Please try again.');
    }
});


// --- Group Event Listeners ---

// Listen for new members joining a chat
bot.on('new_chat_members', async (msg) => {
    const newMember = msg.new_chat_members[0];
    const newMemberId = newMember.id;

    console.log(`${newMember.first_name} joined the group.`);

    const client = await pool.connect();
    try {
        await client.query('BEGIN'); // Start a transaction

        // Find if this new member was referred and their referral is not yet active
        const referralRes = await client.query(
            'SELECT referrer_id FROM referrals WHERE referred_id = $1 AND is_active = false', [newMemberId]
        );

        if (referralRes.rows.length > 0) {
            const { referrer_id } = referralRes.rows[0];

            // 1. Update the referral to active
            await client.query('UPDATE referrals SET is_active = true WHERE referred_id = $1', [newMemberId]);

            // 2. Increment the referrer's count
            await client.query('UPDATE users SET referral_count = referral_count + 1 WHERE telegram_id = $1', [referrer_id]);
            
            await client.query('COMMIT'); // Commit the transaction

            console.log(`Referral completed for ${newMember.first_name} by ${referrer_id}`);

            // Notify the referrer of their success
            bot.sendMessage(referrer_id, `✅ Success! ${newMember.first_name} has joined the group. Your referral count has increased.`).catch(err => console.log(`Could not notify referrer ${referrer_id}.`));
        } else {
            await client.query('ROLLBACK'); // Rollback if no referral found
        }
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error processing new chat member:', error);
    } finally {
        client.release();
    }
});

// Listen for members leaving a chat
bot.on('left_chat_member', async (msg) => {
    const leftMemberId = msg.left_chat_member.id;
    const leftMemberName = msg.left_chat_member.first_name;

    console.log(`${leftMemberName} left the group.`);

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Find if this user was an active referral for someone
        const referralRes = await client.query(
            'SELECT referrer_id FROM referrals WHERE referred_id = $1 AND is_active = true', [leftMemberId]
        );

        if (referralRes.rows.length > 0) {
            const { referrer_id } = referralRes.rows[0];

            // 1. Decrement the referrer's count (ensure it doesn't go below zero)
            await client.query('UPDATE users SET referral_count = GREATEST(0, referral_count - 1) WHERE telegram_id = $1', [referrer_id]);
            
            // 2. Set the referral back to inactive
            await client.query('UPDATE referrals SET is_active = false WHERE referred_id = $1', [leftMemberId]);

            await client.query('COMMIT');

            console.log(`Referral count decreased for ${referrer_id} because ${leftMemberName} left.`);

            // Notify the referrer
            bot.sendMessage(referrer_id, `❗️ Heads up! ${leftMemberName}, whom you referred, has left the group. Your referral count has been updated.`).catch(err => console.log(`Could not notify referrer ${referrer_id}.`));
        } else {
            await client.query('ROLLBACK');
        }
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error processing left chat member:', error);
    } finally {
        client.release();
    }
});

