// test_news_sentiment.ts - 直接测试 newsSentiment 工具
import { registerNewsSentiment } from './src/tools/sentiment/newsSentiment.ts';

// Mock MCPClientManager
class MockMCPManager {
  async callTool(server: string, tool: string, args: any, timeout: number): Promise<any> {
    console.log(`[Mock] callTool: server=${server}, tool=${tool}, args=${JSON.stringify(args)}`);

    // 模拟 newsSentiment 调用 stock-scanner 的三个子工具
    if (tool === 'finnhub_quote') {
      return {
        content: [{ type: 'text', text: JSON.stringify({
          data: { c: 185.5, d: 1.2, dp: 1.2 }  // 模拟股价
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
      // 模拟一些新闻
      const now = Math.floor(Date.now() / 1000);
      return {
        content: [{ type: 'text', text: JSON.stringify([
          { datetime: now - 3600, headline: 'AAPL beats earnings expectations', source: 'reuters' },
          { datetime: now - 7200, headline: 'Apple stock surge on strong iPhone sales', source: 'bloomberg' },
          { datetime: now - 10800, headline: 'AAPL faces market decline in China', source: 'cnbc' },
          { datetime: now - 14400, headline: 'Apple announces new AI breakthrough', source: 'wsj' },
          { datetime: now - 86400, headline: 'Tech sector outlook bullish', source: 'marketwatch' }
        ]) }]
      };
    }
    return { content: [] };
  }
}

const mcpManager = new MockMCPManager();
const tool = registerNewsSentiment(mcpManager);

async function test(ticker: string) {
  console.log(`\n========== 测试 ${ticker} ==========`);
  const result = await tool.handler({
    params: { arguments: { ticker, hours: 72 } }
  });
  console.log(JSON.stringify(result, null, 2));
}

(async () => {
  await test('AAPL');
  await test('TSLA');
  process.exit(0);
})();
