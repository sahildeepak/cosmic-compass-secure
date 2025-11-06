// This file runs on a serverless platform (Netlify Functions, Vercel Functions, etc.)
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
        return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request method or missing body.' }) };
    }

    let clientData;
    try {
        clientData = JSON.parse(event.body);
    } catch (e) {
        return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON body.' }) };
    }

    try {
        // --- UPDATED: Now receives Partner 1 and (optionally) Partner 2 ---
        const { birthDetailsPartner1, birthDetailsPartner2, userQuery, yearInput, readingType, previousReading, zodiacSign, numerologyDetails } = clientData;

        // *** ROBUSTNESS FIX: Validate required data ***
        // Basic validation (can be expanded)
        if (!readingType) {
             return {
                statusCode: 400,
                body: JSON.stringify({ error: 'Invalid request: Missing required readingType.' })
            };
        }
        
        // 3. Build the System Instruction (The Core Logic - Hidden from Client)
        let systemPrompt = '';
        let userPrompt = '';
        
        // *** MARKDOWN BUG FIX ***
        const formattingRule = "Do not use Markdown, headers, lists, or asterisks for bolding. Respond in plain, natural language paragraphs, separated by a single newline.";

        let chartStringP1 = '';
        if (birthDetailsPartner1) {
            chartStringP1 = 
                `\n--- CHART DATA (PARTNER 1) ---\n` +
                `Name: ${birthDetailsPartner1.name || 'N/A'}\n` +
                `DOB: ${birthDetailsPartner1.dob}\n` +
                `TOB: ${birthDetailsPartner1.tob}\n` +
                `City: ${birthDetailsPartner1.city}\n` +
                `--- END CHART DATA (PARTNER 1) ---`;
        }
            
        let chartStringP2 = '';
            
        // --- NEW: Logic for Matching ---
        if (readingType === 'matching') {
            if (!birthDetailsPartner2 || !birthDetailsPartner2.dob || !birthDetailsPartner2.tob || !birthDetailsPartner2.city) {
                return {
                    statusCode: 400,
                    body: JSON.stringify({ error: 'Invalid request: Missing required birth details for Partner 2 for matching.' })
                };
            }
            
            chartStringP2 = 
                `\n--- CHART DATA (PARTNER 2) ---\n` +
                `Name: ${birthDetailsPartner2.name || 'N/A'}\n` +
                `DOB: ${birthDetailsPartner2.dob}\n` +
                `TOB: ${birthDetailsPartner2.tob}\n` +
                `City: ${birthDetailsPartner2.city}\n` +
                `--- END CHART DATA (PARTNER 2) ---`;

            systemPrompt = `You are an expert Vedic astrologer specializing in Kundali Matching (Ashtakoot Milan). Analyze the birth charts of both individuals. Provide a compatibility score (Guna Milan) out of 36. Then, provide a detailed paragraph for each of the 8 Kootas (Varna, Vasya, Tara, Yoni, Graha Maitri, Gana, Bhakoot, Nadi). Finally, give a concluding summary of the match, highlighting strengths, weaknesses, and a final verdict (e.g., Excellent, Good, Average, Challenging). ${formattingRule}`;
            userPrompt = `Generate a full Kundali matching report for Partner 1 and Partner 2 based on their chart data.`;
        
        } else if (readingType === 'health') {
            // Health System Prompt
            systemPrompt = `You are a professional medical astrologer. Analyze the provided birth chart data. Focus your response on the native's innate vitality, potential physical strengths and imbalances (especially those related to the 6th house, Sun, and Moon placements), and suggest holistic well-being practices. Be encouraging and focus on preventative care. ${formattingRule}`;
            userPrompt = `Generate a comprehensive health profile based on this data. Specific health inquiry: ${userQuery || 'N/A'}.`;
        
        } else if (previousReading && userQuery) {
            // Follow-up System Prompt
            systemPrompt = `You are a highly contextual astrology consultant. The user has provided their original chart data, the full previous reading, and a new follow-up question. Use the full context to provide a focused and detailed answer to their follow-up question. Do not repeat the previous reading content. ${formattingRule}`;
            userPrompt = `Based on the following previous reading: "${previousReading}", and the user's natal chart, answer this follow-up question: "${userQuery}".`;
        
        } else if (yearInput) {
            // Annual Forecast System Prompt
            systemPrompt = `You are an expert annual forecaster specializing in Solar Return charts and major transits. Analyze the natal chart for the year ${yearInput}. Focus on major themes, areas of opportunity (Jupiter/Venus transits), and areas requiring caution (Saturn/Mars transits) for the native during that period. ${formattingRule}`;
            userPrompt = `Generate the annual forecast for the year ${yearInput} based on the chart data.`;
        
        // --- NEW: Daily Horoscope Logic ---
        } else if (readingType === 'daily_horoscope') {
            systemPrompt = `You are a concise and insightful astrologer. Provide a 3-paragraph daily horoscope for the given Sun Sign for today. Focus on love, career, and health. ${formattingRule}`;
            userPrompt = `Generate today's daily horoscope for ${zodiacSign}.`;
            chartStringP1 = ''; // No chart data needed

        // --- NEW: Numerology Logic ---
        } else if (readingType === 'numerology') {
            if (!numerologyDetails || !numerologyDetails.name || !numerologyDetails.dob) {
                 return {
                    statusCode: 400,
                    body: JSON.stringify({ error: 'Invalid request: Missing required name and DOB for numerology.' })
                };
            }
            systemPrompt = `You are an expert numerologist. Analyze the user's full name and date of birth. Calculate and provide a detailed explanation for their:
1.  Life Path Number (from DOB)
2.  Destiny (or Expression) Number (from full name)
3.  Soul Urge (or Heart's Desire) Number (from vowels in name)
Provide a final summary paragraph. ${formattingRule}`;
            userPrompt = `Generate a full numerology report for:
Full Name: ${numerologyDetails.name}
Date of Birth: ${numerologyDetails.dob}`;
            chartStringP1 = ''; // No chart data needed

        } else {
            // Natal Chart Overview System Prompt (Default)
            systemPrompt = `You are a world-class, insightful astrologer. Generate a comprehensive Natal Chart Overview, covering the native's sun, moon, and rising sign, along with key planetary aspects that define their personality, career approach, and emotional nature. Keep the tone warm and empowering. ${formattingRule}`;
            userPrompt = `Generate the full natal chart reading. Specific focus if any: ${userQuery || 'N/A'}.`;
        }

        // --- UPDATED: Combine prompts ---
        userPrompt = userPrompt + chartStringP1 + chartStringP2; // chartStringP2 will be empty unless matching

        // 4. Construct the API Payload
        const payload = {
            contents: [{ parts: [{ text: userPrompt }] }],
            // We still use Google Search grounding for accurate, up-to-date astrological interpretations
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
                body: JSON.stringify({ error: `Gemini API Error: ${errorBody}` })
            };
        }

        const result = await response.json();
        
        // 6. Return ONLY the AI's response to the client
        const candidate = result.candidates?.[0];
        const generatedText = candidate?.content?.parts?.[0]?.text;

        if (!generatedText) {
             console.error("No text generated, candidate:", candidate);
             return {
                statusCode: 500,
                body: JSON.stringify({ error: 'AI failed to generate content. This might be due to safety settings.' })
            };
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
            body: JSON.stringify({ error: 'Internal server error during AI generation.' }),
        };
    }
};