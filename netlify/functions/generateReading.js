// This file runs on a serverless platform (Netlify Functions, V..."
// It securely holds the GEMINI_API_KEY and makes the call on behalf of the client.

// IMPORTANT: process.env.GEMINI_API_KEY is retrieved from the Environment Variable 
// you set in the Netlify dashboard.
const GEMINI_API_KEY = process.env.GEMINI_API_KEY; 

// Base URL for the Gemini API call
const API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent';

/**
 * Handles incoming requests from the client-side app and proxies them to Gemini.
 * @param {object} event - The request event containing body data.
 * @param {object} context - The serverless context object.
 */
exports.handler = async (event, context) => {
    // 1. Check for API Key (Security)
    if (!GEMINI_API_KEY) {
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Server configuration error: GEMINI_API_KEY is missing. Please set it as an environment variable in your Netlify settings.' }),
        };
    }

    // 2. Parse Client Request Data (Security/Validation)
    if (event.httpMethod !== 'POST' || !event.body) {
        return { statusCode: 400, body: 'Invalid request method or missing body.' };
    }

    try {
        const clientData = JSON.parse(event.body);
        const { birthDetails, p2Details, userQuery, yearInput, readingType, previousReading, language } = clientData;

        // 3. Build the System Instruction (The Core Logic - Hidden from Client)
        let systemPrompt = '';
        let userPrompt = '';
        const langInstruction = `Respond in ${language === 'hi' ? 'Hindi' : 'English'}.`;
        const formatInstruction = 'Do not use Markdown, headers, or lists. Respond in plain, natural language paragraphs.'; // <-- MARKDOWN FIX

        // --- Partner 1 Chart String ---
        // Validate birthDetails before accessing its properties
        let chartString = '--- CHART DATA (PARTNER 1) ---\n';
        if (birthDetails && birthDetails.dob && birthDetails.tob && birthDetails.city) {
            chartString +=
                `Name: ${birthDetails.name || 'Partner 1'}\n` +
                `DOB: ${birthDetails.dob}\n` +
                `TOB: ${birthDetails.tob}\n` +
                `City: ${birthDetails.city}\n`;
        } else if (readingType !== 'matching') {
            // Only throw error if P1 details are missing and it's not a matching report (where P1 is optional)
             return { statusCode: 400, body: JSON.stringify({ error: 'Invalid Partner 1 birth details.' }) };
        }

        // --- Partner 2 Chart String (for Matching) ---
        if (readingType === 'matching') {
            if (p2Details && p2Details.dob && p2Details.tob && p2Details.city) {
                chartString +=
                    `\n--- CHART DATA (PARTNER 2) ---\n` +
                    `Name: ${p2Details.name || 'Partner 2'}\n` +
                    `DOB: ${p2Details.dob}\n` +
                    `TOB: ${p2Details.tob}\n` +
                    `City: ${p2Details.city}\n`;
            } else {
                 return { statusCode: 400, body: JSON.stringify({ error: 'Invalid Partner 2 birth details for matching.' }) };
            }
        }
        chartString += '--- END CHART DATA ---';


        if (readingType === 'health') {
            // Health System Prompt
            systemPrompt = `You are a professional medical astrologer. Analyze the provided birth chart data. Focus your response on the native's innate vitality, potential physical strengths and imbalances (especially those related to the 6th house, Sun, and Moon placements), and suggest holistic well-being practices. Be encouraging and focus on preventative care. ${langInstruction} ${formatInstruction}`;
            userPrompt = `Generate a comprehensive health profile based on this data. Specific health inquiry: ${userQuery || 'N/A'}.`;
        
        } else if (readingType === 'matching') {
            // Kundali Matching System Prompt (Pro Version - Detailed)
            systemPrompt = `You are an expert Vedic astrologer specializing in Kundali Matching (Ashtakoot Milan). Analyze the birth details of both partners. Provide a Guna Milan score (out of 36) and a detailed paragraph for each of the 8 Kootas (Varna, Vasya, Tara, Yoni, Graha Maitri, Gana, Bhakoot, Nadi). Conclude with a detailed final summary paragraph on compatibility, mentioning any major doshas (like Mangal Dosha) and their potential impact. ${langInstruction} ${formatInstruction}`;
            userPrompt = `Generate a detailed Kundali Matching report for the two partners based on their chart data.`;
        
        } else if (previousReading && userQuery) {
            // Follow-up System Prompt
            systemPrompt = `You are a highly contextual astrology consultant. The user has provided their original chart data, the full previous reading, and a new follow-up question. Use the full context to provide a focused and detailed answer to their follow-up question. Do not repeat the previous reading content. ${langInstruction} ${formatInstruction}`;
            userPrompt = `Based on the following previous reading: "${previousReading}", and the user's natal chart, answer this follow-up question: "${userQuery}".`;
        
        } else if (yearInput) {
            // Annual Forecast System Prompt
            systemPrompt = `You are an expert annual forecaster specializing in Solar Return charts and major transits. Analyze the natal chart for the year ${yearInput}. Focus on major themes, areas of opportunity (Jupiter/Venus transits), and areas requiring caution (Saturn/Mars transits) for the native during that period. ${langInstruction} ${formatInstruction}`;
            userPrompt = `Generate the annual forecast for the year ${yearInput} based on the chart data.`;
        
        } else {
            // Natal Chart Overview System Prompt (Default)
            systemPrompt = `You are a world-class, insightful astrologer. Generate a comprehensive Natal Chart Overview, covering the native's sun, moon, and rising sign, along with key planetary aspects that define their personality, career approach, and emotional nature. Keep the tone warm and empowering. ${langInstruction} ${formatInstruction}`;
            userPrompt = `Generate the full natal chart reading. Specific focus if any: ${userQuery || 'N/A'}.`;
        }

        userPrompt = userPrompt + chartString;

        // 4. Construct the API Payload
        const payload = {
            contents: [{ parts: [{ text: userPrompt }] }],
            tools: [{ "google_search": {} }],
            systemInstruction: { parts: [{ text: systemPrompt }] },
        };

        // 5. Securely Call the Gemini API
        const response = await fetch(`${API_URL}?key=${GEMINI_API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        
        if (!response.ok) {
            const errorBody = await response.text();
            console.error("Gemini API Error:", errorBody);
            return {
                statusCode: response.status,
                body: JSON.stringify({ error: `Gemini API request failed: ${errorBody}` }),
            };
        }

        const result = await response.json();
        
        // 6. Return ONLY the AI's response to the client
        const candidate = result.candidates?.[0];
        const generatedText = candidate?.content?.parts?.[0]?.text;

        if (!generatedText) {
             console.error("No text in candidate:", JSON.stringify(result, null, 2));
             // Check for safety blocks
             if (candidate && candidate.finishReason === 'SAFETY') {
                 return { statusCode: 400, body: JSON.stringify({ error: 'Response blocked for safety reasons.'}) };
             }
             return { statusCode: 500, body: JSON.stringify({ error: 'Could not retrieve AI content from response.'}) };
        }

        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ 
                text: generatedText,
                sources: candidate?.groundingMetadata?.groundingAttributions || [] 
            }),
        };

    } catch (error) {
        console.error("Proxy error:", error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Internal server error during AI generation. Check proxy function logs.' }),
        };
    }
};