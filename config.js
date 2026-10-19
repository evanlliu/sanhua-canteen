/**
 * sanhua-canteen / main 分支公开配置
 * main: GitHub Pages（员工端和独立后台）
 * data: data.json（预约、员工名单、三餐设置）
 *
 * 配置格式参考 midautumn-reservation/main/config.js。
 * 提醒：公开仓库的两个分支都公开；浏览器端的 Token（明文或加密混淆）都无法保密。
 * 不要把正式花名册或真实 PAT 提交到公开仓库中。
 */
window.APP_CONFIG = {
  github: {
    owner: 'evanlliu',          // 如果本次部署的 GitHub 账号不同，在此修改
    repo: 'sanhua-canteen',   // 唯一的仓库名
    branch: 'data',           // 预约数据所在分支
    path: 'data.json',        // data 分支根目录的数据文件

    // 浏览器直写 GitHub 时才需要；配置后任何网页访问者都能读到该 Token。
    // 仅允许配合虚构数据做短期演示，不适合正式员工使用。
    bookingToken: '',
  },
};
