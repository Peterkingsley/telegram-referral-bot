import os

with open('/app/index.js', 'r') as f:
    lines = f.readlines()

new_lines = []
skip = False
in_validation = False
in_bot_init = False
in_webhook_setup = False

for line in lines:
    if 'const token =' in line:
        new_lines.append(line)
        continue
    if 'const databaseUrl =' in line:
        new_lines.append(line)
        continue
    if 'const groupInviteLink =' in line:
        new_lines.append(line)
        continue
    if 'const botUsername =' in line:
        new_lines.append(line)
        continue
    if 'const publicUrl =' in line:
        new_lines.append(line)
        continue

    if '// Basic validation' in line:
        in_validation = True
        new_lines.append(line + '\n')
        new_lines.append('if (!token || !databaseUrl || !groupInviteLink || !botUsername) {\n')
        new_lines.append('    console.error("CRITICAL ERROR: Make sure TELEGRAM_BOT_TOKEN, DATABASE_URL, GROUP_INVITE_LINK, and BOT_USERNAME are set in your .env file.");\n')
        new_lines.append('    process.exit(1);\n')
        new_lines.append('}\n')
        skip = True
        continue

    if in_validation and 'const bot = new TelegramBot' in line:
        in_validation = False
        skip = False
        in_bot_init = True
        new_lines.append('\n// 3. Initialize the Bot, Database, and Web Server\n')
        new_lines.append('const bot = new TelegramBot(token, { polling: !publicUrl }); \n')
        skip = True
        continue

    if in_bot_init and 'const pool = new Pool' in line:
        in_bot_init = False
        skip = False
        new_lines.append(line)
        continue

    if '// --- Webhook Endpoint ---' in line or 'const webhookPath =' in line:
        in_webhook_setup = True
        new_lines.append('\n// --- Webhook / Polling Logic ---\n')
        new_lines.append('if (publicUrl) {\n')
        new_lines.append('    const webhookPath = "/webhook";\n')
        new_lines.append('    const webhookUrl = `${publicUrl}${webhookPath}`;\n\n')
        new_lines.append('    app.post(webhookPath, (req, res) => {\n')
        new_lines.append('        bot.processUpdate(req.body);\n')
        new_lines.append('        res.sendStatus(200);\n')
        new_lines.append('    });\n\n')
        new_lines.append('    app.listen(port, () => {\n')
        new_lines.append('        console.log(`Express server is listening on port ${port} (Webhook Mode)`);\n')
        new_lines.append('        bot.setWebHook(webhookUrl).then(success => {\n')
        new_lines.append('            if (success) console.log(`Webhook set successfully to: ${webhookUrl}`);\n')
        new_lines.append('            else console.error("Failed to set webhook.");\n')
        new_lines.append('        }).catch(e => console.error("Error setting webhook:", e));\n')
        new_lines.append('    });\n')
        new_lines.append('} else {\n')
        new_lines.append('    app.listen(port, () => {\n')
        new_lines.append('        console.log(`Express server is listening on port ${port} (Polling Mode)`);\n')
        new_lines.append('    });\n')
        new_lines.append('}\n')
        skip = True
        continue

    if in_webhook_setup and '// --- Reusable Keyboards' in line:
        in_webhook_setup = False
        skip = False
        new_lines.append(line)
        continue

    if not skip:
        new_lines.append(line)

with open('/app/index.js.new', 'w') as f:
    f.writelines(new_lines)
