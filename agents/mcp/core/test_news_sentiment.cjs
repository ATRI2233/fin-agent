// test_news_sentiment.cjs - CommonJS 方式
const path = require('path');

// 直接 require .ts 文件需要 ts-node 的 require hook
require('ts-node').register({
  transpileOnly: true,
  compilerOptions: { module: 'commonjs' }
});

const { registerNewsSentiment } = require('./src/tools/sentiment/newsSentiment.ts');

class MockMCPManager {
  async callTool(server, tool, args, timeout) {
    console.log(`[Mock] callTool: server=${server}, tool=${tool}`);

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

async function test(ticker) {
  console.log(`\n========== 测试 ${ticker} ==========`);
  const mcpManager = new MockMCPManager();
  const tool = registerNewsSentiment(mcpManager);
  const result = await tool.handler({
    params: { arguments: { ticker, hours: 72 } }
  });
  console.log(JSON.stringify(result, null, 2));
}

(async () => {
  await test('AAPL');
  process.exit(0);
})();
