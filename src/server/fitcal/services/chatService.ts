import { db } from '../../../firebase';
import type { DocumentData, QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { v4 as uuidv4 } from 'uuid';
import { formatDateInTimeZone } from '../utils/timezone';
import { generateCoachResponse, generateSummary, streamCoachResponse } from './geminiService';
import { calculateDailyTargets, UserInfo } from './userInfoService';
import { logger } from '../../../utils/logger';
import { getWebSocketService } from '../../../services/websocketService';

const COACH_REFUSAL_MESSAGE = 'Ben bir FitCal AI kalori koçuyum, bu isteği yerine getiremiyorum.';

const shouldRefuseCoachRequest = (message: string) => {
  const lower = (message || '').toLowerCase();
  if (!lower) {
    return false;
  }

  const disallowedFileTypes = ['pdf', 'doc', 'docx', 'word', 'ppt', 'pptx', 'powerpoint'];
  if (disallowedFileTypes.some(type => lower.includes(type))) {
    return true;
  }

  const createVerbs = ['oluştur', 'üret', 'generate', 'create', 'yap', 'tasarla', 'çiz', 'yaz'];
  const targets = ['görsel', 'resim', 'image', 'logo', 'video', 'kod', 'code', 'script', 'website', 'web sitesi', 'uygulama', 'app'];
  const hasCreateVerb = createVerbs.some(verb => lower.includes(verb));
  const hasTarget = targets.some(target => lower.includes(target));
  return hasCreateVerb && hasTarget;
};

export const createChatSession = async (userId: string) => {
  const now = new Date().toISOString();
  const session = {
    user_id: userId,
    status: 'open',
    created_at: now,
    updated_at: now
  };
  const ref = await db.collection('chat_sessions').add(session);
  return { id: ref.id, ...session };
};

export const listChatSessions = async (userId: string) => {
  const snapshot = await db
    .collection('chat_sessions')
    .where('user_id', '==', userId)
    .orderBy('updated_at', 'desc')
    .get();
  return snapshot.docs.map((doc: QueryDocumentSnapshot<DocumentData>) => ({ id: doc.id, ...doc.data() }));
};

export const listChatMessages = async (sessionId: string) => {
  const snapshot = await db
    .collection('chat_messages')
    .where('session_id', '==', sessionId)
    .orderBy('created_at', 'asc')
    .get();
  return snapshot.docs.map((doc: QueryDocumentSnapshot<DocumentData>) => ({ id: doc.id, ...doc.data() }));
};

const getChatMemorySummary = async (userId: string) => {
  const snapshot = await db
    .collection('chat_memory_summaries')
    .where('user_id', '==', userId)
    .limit(1)
    .get();
  if (snapshot.empty) {
    return null;
  }
  const doc = snapshot.docs[0];
  return { id: doc.id, ...(doc.data() as any) };
};

const maybeUpdateSummary = async (userId: string, sessionId: string) => {
  const messagesSnapshot = await db
    .collection('chat_messages')
    .where('session_id', '==', sessionId)
    .orderBy('created_at', 'desc')
    .limit(50)
    .get();

  if (messagesSnapshot.size < 50) {
    return;
  }

  const messages = messagesSnapshot.docs.map((doc: QueryDocumentSnapshot<DocumentData>) => doc.data() as any).reverse();
  const summaryInput = messages
    .map((msg: { role?: string; content?: string }) => `${msg.role === 'assistant' ? 'Koç' : 'Kullanıcı'}: ${msg.content ?? ''}`)
    .join('\n');

  const summaryText = await generateSummary(summaryInput);
  if (!summaryText) {
    return;
  }

  const existingSummary = await getChatMemorySummary(userId);
  const payload = {
    user_id: userId,
    summary: summaryText,
    last_message_at: new Date().toISOString()
  };

  if (existingSummary) {
    await db.collection('chat_memory_summaries').doc(existingSummary.id).set(payload, { merge: true });
  } else {
    await db.collection('chat_memory_summaries').add(payload);
  }
};

const getRecentStatsSummary = async (user: UserInfo) => {
  const today = new Date();
  const endDate = formatDateInTimeZone(today, user.timezone || 'UTC');
  const startDate = formatDateInTimeZone(
    new Date(today.getTime() - 6 * 24 * 60 * 60_000),
    user.timezone || 'UTC'
  );

  const snapshot = await db
    .collection('daily_stats')
    .where('user_id', '==', user.id)
    .where('date', '>=', startDate)
    .where('date', '<=', endDate)
    .get();

  const stats = snapshot.docs.map((doc: QueryDocumentSnapshot<DocumentData>) => doc.data() as any);
  if (stats.length === 0) {
    return 'Son 7 gün verisi bulunamadı.';
  }

  const totals = stats.reduce(
    (acc: { calories: number; protein: number; carbs: number; fat: number; water: number }, day: any) => {
      acc.calories += day.calories_consumed || 0;
      acc.protein += day.protein_consumed_g || 0;
      acc.carbs += day.carbs_consumed_g || 0;
      acc.fat += day.fat_consumed_g || 0;
      acc.water += day.water_ml || 0;
      return acc;
    },
    { calories: 0, protein: 0, carbs: 0, fat: 0, water: 0 }
  );

  return `Son 7 gün ortalamaları: Kalori ${(totals.calories / stats.length).toFixed(0)} kcal, Protein ${(totals.protein / stats.length).toFixed(0)}g, Karb ${(totals.carbs / stats.length).toFixed(0)}g, Yağ ${(totals.fat / stats.length).toFixed(0)}g, Su ${(totals.water / stats.length / 1000).toFixed(1)}L.`;
};

const buildContext = async (user: UserInfo, stats: any, memorySummary: any, recentMessages: any[], currentMessage: string) => {
  const targets = calculateDailyTargets(user);
  const today = formatDateInTimeZone(new Date(), user.timezone || 'UTC');
  const weeklySummary = await getRecentStatsSummary(user);

  const userContext = `Kullanıcı: ${user.name || 'Bilinmiyor'}, Hedef: ${user.goal || 'maintain'}, Boy/Kilo: ${user.height_cm || '-'} / ${user.current_weight_kg || '-'}`;
  const dailyStats = `Bugün (${today}) Alınan: ${stats?.calories_consumed || 0} kcal (Hedef ${targets.calories_goal} kcal), Protein: ${stats?.protein_consumed_g || 0}g, Su: ${stats?.water_ml || 0}ml, Adım: ${stats?.steps || 0}`;
  const memory = `Hafıza Özeti: ${memorySummary?.summary || 'Yeni kullanıcı, sıcak karşıla.'}`;
  const history = recentMessages
    .map((msg: { role?: string; content?: string }) => `${msg.role === 'assistant' ? 'Koç' : 'Kullanıcı'}: ${msg.content ?? ''}`)
    .join('\n');

  return `${userContext}\n---\n${dailyStats}\n---\n${weeklySummary}\n---\n${memory}\n---\nSon Konuşmalar:\n${history}\n---\nYeni Mesaj: ${currentMessage}`;
};

const prepareChatContext = async (params: {
  user: UserInfo;
  sessionId?: string;
  message: string;
  dailyStats?: any;
  contextTags?: Record<string, unknown>;
  imageMeta?: { mimeType?: string } | null;
}) => {
  const { user, sessionId, message, dailyStats, contextTags, imageMeta } = params;
  const session = sessionId ? { id: sessionId } : await createChatSession(user.id);

  const now = new Date().toISOString();
  const userMessageId = uuidv4();
  await db.collection('chat_messages').doc(userMessageId).set({
    id: userMessageId,
    session_id: session.id,
    role: 'user',
    content: message,
    metadata: contextTags || null,
    image: imageMeta || null,
    created_at: now
  });

  const recentMessagesSnapshot = await db
    .collection('chat_messages')
    .where('session_id', '==', session.id)
    .orderBy('created_at', 'desc')
    .limit(20)
    .get();

  const recentMessages = recentMessagesSnapshot.docs.map((doc: QueryDocumentSnapshot<DocumentData>) => doc.data() as any).reverse();
  const memorySummary = await getChatMemorySummary(user.id);

  const context = await buildContext(user, dailyStats, memorySummary, recentMessages, message);
  const history = recentMessages.map((item: { role?: string; content?: string }) => ({ role: item.role, content: item.content }));

  return {
    session,
    userMessageId,
    recentMessages,
    memorySummary,
    context,
    history,
  };
};

export const handleChatMessage = async (params: {
  user: UserInfo;
  sessionId?: string;
  message: string;
  dailyStats?: any;
  contextTags?: Record<string, unknown>;
  imagePayload?: { data: string; mimeType: string } | null;
}) => {
  const { user, sessionId, message, dailyStats, contextTags, imagePayload } = params;
  const imageMeta = imagePayload ? { mimeType: imagePayload.mimeType } : null;
  const { session, context, history } = await prepareChatContext({
    user,
    sessionId,
    message,
    dailyStats,
    contextTags,
    imageMeta
  });

  logger.info({ userId: user.id, sessionId: session.id }, 'FitCal chat context assembled');
  const replyText = shouldRefuseCoachRequest(message)
    ? COACH_REFUSAL_MESSAGE
    : await generateCoachResponse(context, history, imagePayload || undefined);

  const assistantMessageId = uuidv4();
  await db.collection('chat_messages').doc(assistantMessageId).set({
    id: assistantMessageId,
    session_id: session.id,
    role: 'assistant',
    content: replyText,
    metadata: contextTags || null,
    created_at: new Date().toISOString()
  });

  await db.collection('chat_sessions').doc(session.id).set(
    {
      updated_at: new Date().toISOString()
    },
    { merge: true }
  );

  await maybeUpdateSummary(user.id, session.id);

  return {
    reply: replyText,
    sessionId: session.id
  };
};

export const handleChatMessageStream = async (params: {
  user: UserInfo;
  sessionId?: string;
  message: string;
  dailyStats?: any;
  contextTags?: Record<string, unknown>;
  imagePayload?: { data: string; mimeType: string } | null;
}) => {
  const { user, sessionId, message, dailyStats, contextTags, imagePayload } = params;
  const imageMeta = imagePayload ? { mimeType: imagePayload.mimeType } : null;
  const { session, context, history } = await prepareChatContext({
    user,
    sessionId,
    message,
    dailyStats,
    contextTags,
    imageMeta,
  });

  const assistantMessageId = uuidv4();
  const websocket = getWebSocketService();

  const sendChunk = (payload: { delta?: string; content?: string; isFinal?: boolean; error?: string }) => {
    websocket?.sendToUser(user.id, 'chat:stream', {
      chatId: session.id,
      messageId: assistantMessageId,
      ...payload,
    });
  };

  const finalizeAndPersist = async (content: string) => {
    await db.collection('chat_messages').doc(assistantMessageId).set({
      id: assistantMessageId,
      session_id: session.id,
      role: 'assistant',
      content,
      metadata: contextTags || null,
      created_at: new Date().toISOString()
    });

    await db.collection('chat_sessions').doc(session.id).set(
      {
        updated_at: new Date().toISOString()
      },
      { merge: true }
    );

    await maybeUpdateSummary(user.id, session.id);
  };

  const runStream = async () => {
    if (shouldRefuseCoachRequest(message)) {
      sendChunk({ delta: COACH_REFUSAL_MESSAGE, isFinal: true, content: COACH_REFUSAL_MESSAGE });
      await finalizeAndPersist(COACH_REFUSAL_MESSAGE);
      return;
    }

    let sentAny = false;
    let latestText = '';

    try {
      latestText = await streamCoachResponse({
        context,
        history,
        image: imagePayload || undefined,
        onDelta: (delta, fullText) => {
          sentAny = true;
          latestText = fullText;
          sendChunk({ delta });
        },
      });

      const finalText = latestText || '';
      sendChunk({ content: finalText, isFinal: true });
      await finalizeAndPersist(finalText);
    } catch (error) {
      logger.error({ err: error, userId: user.id, sessionId: session.id }, 'Gemini streaming failed');
      if (!sentAny) {
        const fallback = await generateCoachResponse(context, history, imagePayload || undefined);
        sendChunk({ content: fallback, delta: fallback, isFinal: true });
        await finalizeAndPersist(fallback);
      } else {
        sendChunk({ error: 'Streaming failed', isFinal: true, content: latestText || '' });
        if (latestText) {
          await finalizeAndPersist(latestText);
        }
      }
    }
  };

  return {
    sessionId: session.id,
    messageId: assistantMessageId,
    run: runStream,
  };
};
