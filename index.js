// --- Full Webhook Application File (index.js) ---

// 1. Import necessary libraries
require('dotenv').config(); // Loads environment variables from a .env file
const TelegramBot = require('node-telegram-bot-api');
const { Pool } = require('pg'); // PostgreSQL client
const express = require('express'); // For the web service
const cors = require('cors'); // ✅ FIX: Import the CORS library

// 2. Get secrets from environment variables
const token = process.env.TELEGRAM_BOT_TOKEN;
const databaseUrl = process.env.DATABASE_URL;
const groupInviteLink = process.env.GROUP_INVITE_LINK;
const botUsername = process.env.BOT_USERNAME;
const publicUrl = process.env.PUBLIC_URL; // The public HTTPS URL of your service (e.g., https://sales-5l55.onrender.com)

// Basic validation
if (!token || !databaseUrl || !groupInviteLink || !botUsername || !publicUrl) {
    console.error('CRITICAL ERROR: Make sure TELEGRAM_BOT_TOKEN, DATABASE_URL, GROUP_INVITE_LINK, BOT_USERNAME, and PUBLIC_URL are set in your .env file.');
    process.exit(1);
}

// 3. Initialize the Bot, Database, and Web Server
// Disable polling as we are switching to webhooks
const bot = new TelegramBot(token, { polling: false }); 
const pool = new Pool({
    connectionString: databaseUrl,
    // Required for connecting to cloud databases like on Render
    ssl: {
        rejectUnauthorized: false
    }
});

// Initialize Express
const app = express(); // 'app' is defined here!
const port = process.env.PORT || 10000; 

// ✅ FIX: Use CORS middleware immediately after app initialization
app.use(cors());

// Middleware to parse the incoming JSON payload from Telegram
app.use(express.json());

// Set the bot commands that appear in the menu
bot.setMyCommands([
    { command: 'start', description: '🚀 Restart the bot' },
    { command: 'mylink', description: '🔗 My referral link' },
    { command: 'rank', description: '🏆 Check my rank' },
    { command: 'top10', description: '📈 Show the leaderboard' },
]);

// --- Webhook Endpoint ---
const webhookPath = '/webhook';
const webhookUrl = `${publicUrl}${webhookPath}`;

app.post(webhookPath, (req, res) => {
    // Pass the update body to the bot library
    bot.processUpdate(req.body); 

    // IMPORTANT: Telegram requires an immediate 200 OK response
    res.sendStatus(200); 
});

// Start the Express server
app.listen(port, () => {
    console.log(`Express server is listening on port ${port}`);

    // Set the webhook once the server is successfully listening
    bot.setWebHook(webhookUrl).then(success => {
        if (success) {
            console.log(`Webhook set successfully to: ${webhookUrl}`);
        } else {
            console.error('Failed to set webhook.');
        }
    }).catch(e => console.error('Error setting webhook:', e));
});


// --- Reusable Keyboards (No Change) ---

const mainMenuKeyboard = {
    reply_markup: {
        inline_keyboard: [
            [{ text: '🚀 Restart Bot', callback_data: 'main_menu' }, { text: '🔗 My referral link', callback_data: 'get_link' }],
            [{ text: '🏆 My Rank', callback_data: 'get_rank' }, { text: '📈 Leaderboard', callback_data: 'get_leaderboard' }]
        ]
    }
};

const myLinkKeyboard = {
    reply_markup: {
        inline_keyboard: [
            [{ text: '🏆 My Rank', callback_data: 'get_rank' }, { text: '📈 Leaderboard', callback_data: 'get_leaderboard' }],
            [{ text: '⬅️ Back to Menu', callback_data: 'main_menu' }]
        ]
    }
};

const myRankKeyboard = {
    reply_markup: {
        inline_keyboard: [
            [{ text: '🔗 My referral link', callback_data: 'get_link' }, { text: '📈 Leaderboard', callback_data: 'get_leaderboard' }],
            [{ text: '⬅️ Back to Menu', callback_data: 'main_menu' }]
        ]
    }
};

const leaderboardKeyboard = {
    reply_markup: {
        inline_keyboard: [
            [{ text: '🔗 My referral link', callback_data: 'get_link' }, { text: '🏆 My Rank', callback_data: 'get_rank' }],
            [{ text: '⬅️ Back to Menu', callback_data: 'main_menu' }]
        ]
    }
};


// --- Database Helper Functions (No Change) ---

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

// --- Bot Command Handlers (No Change) ---

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

                if (!existingReferral) {
                    // This is a completely new referral
                    await client.query('INSERT INTO referrals (referrer_id, referred_id) VALUES ($1, $2)', [newReferrerId, userId]);
                    bot.sendMessage(chatId, `Welcome, ${firstName}! You were referred. Please join our group to complete the referral.`);
                    bot.sendMessage(chatId, `Here is the link to the group: ${groupInviteLink}`);
                    bot.sendMessage(newReferrerId, `🎉 Great news! ${firstName} has used your referral link. You'll get your point once they join the group.`).catch(err => console.log(`Could not notify referrer ${newReferrerId}, maybe they blocked the bot.`));
                } else if (existingReferral && !existingReferral.is_active) {
                    // User exists but left the group. We can re-assign them to a new referrer.
                    await client.query('UPDATE referrals SET referrer_id = $1 WHERE referred_id = $2', [newReferrerId, userId]);
                    bot.sendMessage(chatId, `Welcome back, ${firstName}! You are being referred by a new user. Please join the group to complete the referral.`);
                    bot.sendMessage(chatId, `Here is the link to the group: ${groupInviteLink}`);
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
            const welcomeMessage = `🚀 Welcome to the Rishu Referral Race!\n\nWhere meme lovers and traders battle for glory and real rewards. 💰\n🔥 Here’s what’s up:\n\nInvite your friends to join the Rishu Telegram community and climb the leaderboard.\n\nTop referrers win:\n\n🥇 $100\n🥈 $60\n🥉 $40\n\n👉 Use the buttons below to get your referral link, check your rank, or see the leaderboard.\n\nLet’s make Rishu go viral. The more you invite, the higher you rise. 🌕\n\n#RishuArmy | #RishuCoin | #ReferralRace`;

            bot.sendMessage(chatId, welcomeMessage, mainMenuKeyboard);
        }
    } catch (error) {
        console.error('Error in /start handler:', error);
        bot.sendMessage(chatId, 'Sorry, something went wrong. Please try again later.');
    }
});

// Handler for the /mylink command
bot.onText(/\/mylink/, (msg) => {
    const chatId = msg.chat.id;
    const referralLink = `https://t.me/${botUsername}?start=${chatId}`;
    const message = `Here is your unique referral link.\nClick the link below to copy it 👇\n\n\`${referralLink}\``;
    const options = {
        ...myLinkKeyboard,
        disable_web_page_preview: true,
        parse_mode: 'Markdown'
    };
    bot.sendMessage(chatId, message, options);
});


// Handler for the /rank command
bot.onText(/\/rank/, async (msg) => {
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
            bot.sendMessage(chatId, `You have **${referral_count}** referrals.\nYour current rank is **${position}**!`, { ...myRankKeyboard, parse_mode: 'Markdown' });
        } else {
            bot.sendMessage(chatId, "You haven't referred anyone yet. Use your referral link to get started!", myRankKeyboard);
        }
    } catch (error) {
        console.error('Error in /rank handler:', error);
        bot.sendMessage(chatId, 'Could not retrieve your rank. Please try again.', myRankKeyboard);
    }
});


// Handler for the /top10 command
bot.onText(/\/top10/, async (msg) => {
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
            bot.sendMessage(chatId, 'The leaderboard is empty. No one has any referrals yet!', leaderboardKeyboard);
            return;
        }

        let leaderboardText = '🏆 **Top 10 Referrers** 🏆\n\n';
        res.rows.forEach((row, index) => {
            const name = row.username ? `@${row.username}` : row.first_name;
            leaderboardText += `${index + 1}. ${name} - ${row.referral_count} referral(s)\n`;
        });

        bot.sendMessage(chatId, leaderboardText, { ...leaderboardKeyboard, parse_mode: 'Markdown' });
    } catch (error) {
        console.error('Error in /top10 handler:', error);
        bot.sendMessage(chatId, 'Could not retrieve the leaderboard. Please try again.', leaderboardKeyboard);
    }
});

// --- Callback Query Handler (No Change) ---
bot.on('callback_query', async (callbackQuery) => {
    const msg = callbackQuery.message;
    const chatId = msg.chat.id;
    const data = callbackQuery.data;

    // Acknowledge the button press
    bot.answerCallbackQuery(callbackQuery.id);

    if (data === 'main_menu') {
        const welcomeMessage = `🚀 Welcome to the Rishu Referral Race!\n\nWhere meme lovers and traders battle for glory and real rewards. 💰\n🔥 Here’s what’s up:\n\nInvite your friends to join the Rishu Telegram community and climb the leaderboard.\n\nTop referrers win:\n\n🥇 $100\n🥈 $60\n🥉 $40\n\n👉 Use the buttons below to get your referral link, check your rank, or see the leaderboard.\n\nLet’s make Rishu go viral. The more you invite, the higher you rise. 🌕\n\n#RishuArmy | #RishuCoin | #ReferralRace`;
        bot.sendMessage(chatId, welcomeMessage, mainMenuKeyboard);

    } else if (data === 'get_link') {
        const referralLink = `https://t.me/${botUsername}?start=${chatId}`;
        const message = `Here is your unique referral link.\nClick the link below to copy it 👇\n\n\`${referralLink}\``;
        const options = {
            ...myLinkKeyboard,
            disable_web_page_preview: true,
            parse_mode: 'Markdown'
        };
        bot.sendMessage(chatId, message, options);

    } else if (data === 'get_rank') {
        try {
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
                bot.sendMessage(chatId, `You have **${referral_count}** referrals.\nYour current rank is **${position}**!`, { ...myRankKeyboard, parse_mode: 'Markdown' });
            } else {
                bot.sendMessage(chatId, "You haven't referred anyone yet. Use your referral link to get started!", myRankKeyboard);
            }
        } catch (error) {
            console.error('Error in get_rank callback:', error);
            bot.sendMessage(chatId, 'Could not retrieve your rank. Please try again.', myRankKeyboard);
        }

    } else if (data === 'get_leaderboard') {
        try {
            const res = await pool.query(
                'SELECT first_name, username, referral_count FROM users WHERE referral_count > 0 ORDER BY referral_count DESC LIMIT 10'
            );

            if (res.rows.length === 0) {
                bot.sendMessage(chatId, 'The leaderboard is empty. No one has any referrals yet!', leaderboardKeyboard);
                return;
            }

            let leaderboardText = '🏆 **Top 10 Referrers** 🏆\n\n';
            res.rows.forEach((row, index) => {
                const name = row.username ? `@${row.username}` : row.first_name;
                leaderboardText += `${index + 1}. ${name} - ${row.referral_count} referral(s)\n`;
            });

            bot.sendMessage(chatId, leaderboardText, { ...leaderboardKeyboard, parse_mode: 'Markdown' });
        } catch (error) {
            console.error('Error in get_leaderboard callback:', error);
            bot.sendMessage(chatId, 'Could not retrieve the leaderboard. Please try again.', leaderboardKeyboard);
        }
    }
});


// --- Broadcast Endpoint ---

/**
 * Sends a message to all users in the database.
 * NOTE: Telegram bot limits apply (usually 30 messages/second).
 * @param {string} message - The message text to send.
 * @returns {Promise<{total: number, success: number, failed: number}>} Results of the broadcast.
 */
async function broadcastMessage(message) {
    const client = await pool.connect();
    let successCount = 0;
    let failureCount = 0;

    try {
        // Fetch all user Telegram IDs
        const res = await client.query('SELECT telegram_id FROM users');
        const userIds = res.rows.map(row => row.telegram_id);

        console.log(`Starting broadcast to ${userIds.length} users...`);

        // Send the message to each user
        for (const id of userIds) {
            try {
                // ✅ FIX: Removed { parse_mode: 'Markdown' } to send as plain text and avoid entity errors
                await bot.sendMessage(id, message); 
                successCount++;
                
                // Simple rate limiting (1 second delay for every 20 messages)
                if (successCount % 20 === 0) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            } catch (err) {
                failureCount++;
                
                // 🛑 NEW FIX: ETELEGRAM: 403 Forbidden means the user blocked the bot.
                // We should remove them from the database to stop messaging them.
                if (err.response && err.response.statusCode === 403) {
                    console.log(`User ${id} blocked the bot. Removing from database.`);
                    // Use a separate query to delete the blocked user
                    await client.query('DELETE FROM users WHERE telegram_id = $1', [id]).catch(e => {
                        console.error(`Error deleting blocked user ${id}: ${e.message}`);
                    });
                } else {
                    // Log other errors (e.g., network issues, temporary failures)
                    console.error(`Failed to send message to user ${id}: ${err.message}`);
                }
            }
        }
    } finally {
        client.release();
    }
    return { total: successCount + failureCount, success: successCount, failed: failureCount };
}

// **CORRECTED ENDPOINT**: Now an async function that AWAITS the broadcast.
app.post('/broadcast', async (req, res) => {
    // 1. Validation (only checking for the message content)
    const { message } = req.body;

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
        return res.status(400).json({ error: 'Missing or empty message body.' });
    }

    // 2. Execute Broadcast (Wait for it to complete)
    try {
        // The time taken here is proportional to the number of users in your database.
        const results = await broadcastMessage(message);
        console.log(`Broadcast finished: ${results.success} sent, ${results.failed} failed. Total clean: ${results.failed} removals attempted.`);

        // 3. Respond with the final counts (Success, Failed)
        res.json({ 
            status: 'Broadcast completed.',
            success_count: results.success,
            failed_count: results.failed
        });

    } catch (err) {
        console.error('Major error during broadcast:', err);
        // Respond with a 500 status on major failure
        res.status(500).json({ error: 'Major server error occurred during broadcast execution.' });
    }
});


// --- Group Event Listeners (No Change) ---

// Listen for new members joining a chat
bot.on('new_chat_members', async (msg) => {
    const newMember = msg.new_chat_members[0];
    const newMemberId = newMember.id;
    const backToMenuKeyboard = {
        reply_markup: {
            inline_keyboard: [
                [{ text: '⬅️ Back to Menu', callback_data: 'main_menu' }]
            ]
        }
    };

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
            bot.sendMessage(referrer_id, `✅ Success! ${newMember.first_name} has joined the group. Your referral count has increased.`, backToMenuKeyboard).catch(err => console.log(`Could not notify referrer ${referrer_id}.`));
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
    const backToMenuKeyboard = {
        reply_markup: {
            inline_keyboard: [
                [{ text: '⬅️ Back to Menu', callback_data: 'main_menu' }]
            ]
        }
    };

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
            bot.sendMessage(referrer_id, `❗️ Heads up! ${leftMemberName}, whom you referred, has left the group. Your referral count has been updated.`, backToMenuKeyboard).catch(err => console.log(`Could not notify referrer ${referrer_id}.`));
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