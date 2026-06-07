// test_news_sentiment.mts
import { registerNewsSentiment } from './src/tools/sentiment/newsSentiment.ts';

class MockMCPManager {
  async callTool(server: string, tool: string, args: any, timeout: number): Promise<any> {
    console.log(`[Mock] callTool: ${server}.${tool}`);

    if (tool === 'finnhub_quote') {
      return {
        content: [{ type: 'text', text: JSON.stringify({
          data: { c: 185.5, d: 1.2, dp: 1.2 }
        }) }]
      };
    }
    if (tool === 'sentiment_fear_greed') {
      return {
        content: [{ type: 'text', text: JSON.stringify({
          data: [{ score: 65, rating: 'Greed' }]
        }) }]
      };
    }
    if (tool === 'finnhub_company_news') {
      const now = Math.floor(Date.now() / 1000);
      return {
        content: [{ type: 'text', text: JSON.stringify([
          { datetime: now - 3600, headline: 'AAPL beats earnings expectations', source: 'reuters' },
          { datetime: now - 7200, headline: 'Apple stock surge on strong iPhone sales', source: 'bloomberg' },
          { datetime: now - 10800, headline: 'AAPL faces market decline in China', source: 'cnbc' },
          { datetime: now - 14400, headline: 'Apple announces new AI breakthrough', source: 'wsj' },
          { datetime: now - 86400, headline: 'Tech sector outlook bearish warning', source: 'marketwatch' }
        ]) }]
      };
    }
    return { content: [] };
  }
}

async function test(ticker: string) {
  console.log(`\n========== 测试 ${ticker} ==========`);
  const mcpManager = new MockMCPManager();
  const tool = registerNewsSentiment(mcpManager);
  const result = await tool.handler({
    params: { arguments: { ticker, hours: 72 } }
  });
  console.log(JSON.stringify(result, null, 2));
}

async function testEmpty(ticker: string) {
  console.log(`\n========== 测试 ${ticker} (无新闻) ==========`);
  class EmptyMock extends MockMCPManager {
    async callTool(server: string, tool: string, args: any, timeout: number) {
      if (tool === 'finnhub_quote') {
        return { content: [{ type: 'text', text: JSON.stringify({ data: { c: 100, d: 0, dp: 0 } }) }] };
      }
      if (tool === 'sentiment_fear_greed') {
        return { content: [{ type: 'text', text: JSON.stringify({ data: [{ score: 50, rating: 'Neutral' }] }) }] };
      }
      if (tool === 'finnhub_company_news') {
        return { content: [{ type: 'text', text: '[]' }] };
      }
      return { content: [] };
    }
  }
  const mcpManager = new EmptyMock();
  const tool = registerNewsSentiment(mcpManager);
  const result = await tool.handler({
    params: { arguments: { ticker, hours: 72 } }
  });
  console.log(JSON.stringify(result, null, 2));
}

async function testError() {
  console.log(`\n========== 测试错误情况 (无 ticker) ==========`);
  const mcpManager = new MockMCPManager();
  const tool = registerNewsSentiment(mcpManager);
  const result = await tool.handler({
    params: { arguments: {} }
  });
  console.log(JSON.stringify(result, null, 2));
}

(async () => {
  await test('AAPL');
  await testEmpty('XYZ123');
  await testError();
  process.exit(0);
})();
