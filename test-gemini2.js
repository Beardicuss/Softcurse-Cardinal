const fs = require('fs');

async function test() {
    const cfg = JSON.parse(fs.readFileSync('C:\\Users\\DanTe\\AppData\\Roaming\\cardinal\\config.json', 'utf8'));
    const store = JSON.parse(fs.readFileSync('C:\\Users\\DanTe\\AppData\\Roaming\\cardinal\\cardinal.json', 'utf8'));
    const messages = store.conversations || [];
    const systemPrompt = "test system";

    const reqBody = {
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: messages.map(m => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content }]
        }))
    };

    console.log(JSON.stringify(reqBody, null, 2));

    const gapi = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${cfg.geminiKey}`;
    const res = await fetch(gapi, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reqBody)
    });

    console.log('Status:', res.status, res.statusText);
    const text = await res.text();
    console.log('Body:', text);
}
test().catch(console.error);
