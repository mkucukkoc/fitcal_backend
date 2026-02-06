import axios from 'axios';
import { logger } from '../../../utils/logger';
import { BIG_SYSTEM_PROMPT, MASTER_FOOD_ANALYSIS_PROMPT } from '../constants';

const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const DEFAULT_GEMINI_VISION_MODEL = process.env.GEMINI_VISION_MODEL
  || process.env.GEMINI_MODEL
  || 'gemini-2.5-flash';
const DEFAULT_GEMINI_CHAT_MODEL = process.env.GEMINI_CHAT_MODEL
  || process.env.GEMINI_MODEL
  || 'gemini-2.5-pro';
const DEFAULT_GEMINI_SUMMARY_MODEL = process.env.GEMINI_SUMMARY_MODEL
  || process.env.GEMINI_MODEL
  || 'gemini-2.5-flash';

const getApiKey = () => process.env.GEMINI_API_KEY || '';

const cleanJsonResponse = (text: string) => {
  return text.replace(/```json|```/g, '').trim();
};

const createMockAnalysis = (language: string) => {
  const isTurkish = (language || '').toLowerCase().startsWith('tr');
  return {
    total_calories: 480,
    total_macros: { p: 32, c: 46, f: 18 },
    items: [
      {
        name: isTurkish ? 'Tavuk Izgara' : 'Grilled Chicken',
        amount: 150,
        unit: 'g',
        calories: 248,
        macros: { p: 31, c: 0, f: 5 }
      },
      {
        name: isTurkish ? 'Kinoa' : 'Quinoa',
        amount: 120,
        unit: 'g',
        calories: 170,
        macros: { p: 6, c: 30, f: 3 }
      },
      {
        name: isTurkish ? 'Salata' : 'Salad',
        amount: 80,
        unit: 'g',
        calories: 62,
        macros: { p: 2, c: 10, f: 2 }
      }
    ],
    confidence: 0.38,
    health_score: 78,
    coach_note: isTurkish
      ? 'Demo modunda örnek bir analiz gösteriliyor. Gerçek analiz için GEMINI_API_KEY ekleyin.'
      : 'Showing a demo analysis. Add GEMINI_API_KEY for real meal analysis.'
  };
};

type GeminiResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
  }>;
};

type ChatHistoryItem = {
  role: string;
  content: string;
};

type InlineImagePayload = {
  data: string;
  mimeType: string;
};

const extractCandidateText = (candidate?: any) => {
  if (!candidate?.content?.parts?.length) {
    return '';
  }
  return candidate.content.parts
    .map((part: { text?: string }) => part?.text || '')
    .join('')
    .trim();
};

const buildGeminiContents = (history: ChatHistoryItem[], image?: InlineImagePayload) => {
  if (!Array.isArray(history)) {
    return [];
  }

  return history.map((item, index) => {
    const role = item.role === 'assistant' ? 'model' : 'user';
    const isLast = index === history.length - 1;
    const parts: Array<{ text?: string; inlineData?: { data: string; mimeType: string } }> = [];

    if (item.content) {
      parts.push({ text: item.content });
    }

    if (image && isLast && role === 'user') {
      parts.push({
        inlineData: {
          data: image.data,
          mimeType: image.mimeType,
        },
      });
    }

    if (!parts.length) {
      parts.push({ text: 'Kullanıcı bir görsel paylaştı.' });
    }

    return { role, parts };
  });
};

export const analyzeMealImage = async (
  imageBase64: string,
  mimeType: string,
  language: string,
  model?: string
) => {
  const apiKey = getApiKey();
  if (!apiKey) {
    if (process.env.NODE_ENV !== 'production') {
      logger.warn('GEMINI_API_KEY missing; returning mock analysis for non-production');
      return createMockAnalysis(language);
    }
    throw new Error('GEMINI_API_KEY is not configured');
  }

  const resolvedModel = model || DEFAULT_GEMINI_VISION_MODEL;
  logger.info({ mimeType, language }, 'Gemini meal analysis request started');
  const requestBody = {
    contents: [
      {
        role: 'user',
        parts: [
          { text: `${MASTER_FOOD_ANALYSIS_PROMPT}\n\nDil: ${language || 'tr'}.` },
          {
            inlineData: {
              data: imageBase64,
              mimeType
            }
          }
        ]
      }
    ]
  };

  const response = await axios.post<GeminiResponse>(
    `${GEMINI_BASE_URL}/models/${resolvedModel}:generateContent?key=${apiKey}`,
    requestBody
  );

  const text = response.data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  if (!text) {
    logger.warn({ response: response.data }, 'Gemini analysis returned empty response');
    throw new Error('Gemini returned empty response');
  }

  const cleaned = cleanJsonResponse(text);
  return JSON.parse(cleaned);
};

export const generateCoachResponse = async (
  context: string,
  history: Array<{ role: string; content: string }>,
  image?: InlineImagePayload
) => {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured');
  }

  logger.info({ historyCount: history.length }, 'Gemini coach response request started');
  const contents = buildGeminiContents(history, image);

  const requestBody = {
    systemInstruction: {
      parts: [{ text: `${BIG_SYSTEM_PROMPT}\n\nCONTEXT:\n${context}` }]
    },
    contents
  };

  const response = await axios.post<GeminiResponse>(
    `${GEMINI_BASE_URL}/models/${DEFAULT_GEMINI_CHAT_MODEL}:generateContent?key=${apiKey}`,
    requestBody
  );

  const text = response.data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  if (!text) {
    logger.warn({ response: response.data }, 'Gemini chat returned empty response');
    throw new Error('Gemini returned empty response');
  }

  return text.trim();
};

export const streamCoachResponse = async (params: {
  context: string;
  history: Array<{ role: string; content: string }>;
  image?: InlineImagePayload;
  onDelta: (delta: string, fullText: string) => void;
  onEvent?: (payload: any) => void;
}) => {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured');
  }

  const { context, history, image, onDelta, onEvent } = params;
  logger.info({ historyCount: history.length }, 'Gemini coach streaming request started');

  const contents = buildGeminiContents(history, image);
  const requestBody = {
    systemInstruction: {
      parts: [{ text: `${BIG_SYSTEM_PROMPT}\n\nCONTEXT:\n${context}` }],
    },
    contents,
  };

  const response = await axios.post(
    `${GEMINI_BASE_URL}/models/${DEFAULT_GEMINI_CHAT_MODEL}:streamGenerateContent?key=${apiKey}&alt=sse`,
    requestBody,
    {
      responseType: 'stream',
      headers: {
        Accept: 'text/event-stream',
      },
    }
  );

  return new Promise<string>((resolve, reject) => {
    let buffer = '';
    let fullText = '';
    const stream = response.data as NodeJS.ReadableStream;

    const handleLine = (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) {
        return;
      }

      let payloadText = trimmed;
      if (payloadText.startsWith('data:')) {
        payloadText = payloadText.replace(/^data:\s*/, '');
      }

      if (!payloadText || payloadText === '[DONE]') {
        return;
      }

      try {
        const parsed = JSON.parse(payloadText);
        onEvent?.(parsed);
        const candidate = parsed?.candidates?.[0];
        const candidateText = extractCandidateText(candidate);
        if (!candidateText) {
          return;
        }

        let delta = candidateText;
        if (fullText && candidateText.startsWith(fullText)) {
          delta = candidateText.slice(fullText.length);
        }

        if (delta) {
          fullText += delta;
          onDelta(delta, fullText);
        }
      } catch (error) {
        logger.debug({ line: trimmed, err: error }, 'Failed to parse Gemini stream payload');
      }
    };

    stream.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';
      lines.forEach(handleLine);
    });

    stream.on('end', () => {
      if (buffer.trim().length > 0) {
        handleLine(buffer);
      }
      resolve(fullText.trim());
    });

    stream.on('error', (error: any) => {
      reject(error);
    });
  });
};

export const generateSummary = async (summaryInput: string) => {
  const apiKey = getApiKey();
  if (!apiKey) {
    return null;
  }

  const requestBody = {
    contents: [
      {
        role: 'user',
        parts: [
          {
            text: `Aşağıdaki konuşmayı 3-4 cümlelik kısa bir hafıza özeti olarak yaz.\n\n${summaryInput}`
          }
        ]
      }
    ]
  };

  try {
    const response = await axios.post<GeminiResponse>(
      `${GEMINI_BASE_URL}/models/${DEFAULT_GEMINI_SUMMARY_MODEL}:generateContent?key=${apiKey}`,
      requestBody
    );
    return response.data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;
  } catch (error) {
    logger.warn({ err: error }, 'Failed to generate summary');
    return null;
  }
};
