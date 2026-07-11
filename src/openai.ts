import OpenAI from 'openai';

let openai: OpenAI | null = null;

export const initOpenAI = (apiKey: string) => {
  openai = new OpenAI({
    apiKey,
    dangerouslyAllowBrowser: true // This is safe for a local desktop app
  });
};

export const askCopilot = async (
  context: string,
  history: { role: 'user' | 'assistant', content: string }[],
  question: string,
  imageSrc?: string
): Promise<string> => {
  if (!openai) {
    throw new Error('OpenAI not initialized');
  }

  const systemMessage = `You are an expert interview copilot. 
Your goal is to help the user answer questions based on the provided context.
Keep your answers concise, accurate, and directly address the user's prompt.
Here is the pre-meeting context:\n\n${context}`;

  const messages: any[] = [
    { role: 'system', content: systemMessage },
    ...history,
  ];

  const userContent: any[] = [];
  if (question) {
    userContent.push({ type: 'text', text: question });
  }
  if (imageSrc) {
    userContent.push({
      type: 'image_url',
      image_url: {
        url: imageSrc
      }
    });
  }

  messages.push({ role: 'user', content: userContent });

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages,
    max_tokens: 1000,
  });

  return response.choices[0].message.content || '';
};
