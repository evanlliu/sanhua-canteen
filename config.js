/**
 * sanhua-canteen / main 分支配置（参照 midautumn-reservation）
 * main: GitHub Pages; data: data.json
 * tokenCiphertext / keyMaterial 由 token-tool.html 在本地生成。
 * 重要：密文与密钥材料同时公开，浏览器可还原 PAT！仅适合虚构数据临时测试。
 */
window.APP_CONFIG = {
  github: {
    owner: 'evanlliu',
    repo: 'sanhua-canteen',
    branch: 'data',
    path: 'data.json',

    // 本地打开 token-tool.html，填写 PAT 并生成，复制结果粘贴到以下两个字段。
    tokenCiphertext: 'BzSHFZhrZn5cp9O2CjHBxlwNmTfkWmccRBzWYYLkSKMomd0kYj+CSy5KOw0MjFY7yAu36CgeER+yVaRz1fDigWpqnrqB+Fqx63KmUQt/7J3Z5JmhbNI2SVanl3srKNa+1Mi1st8kWCJPaffFYwmLvb46dcmjqN6MRQ==',
keyMaterial: '9aaf8d013a8cca93c7836b8e5eedd675cb2eb492f5045115',
  },
};
