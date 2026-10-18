// 演示商城的最小商品表：6 件，够走完「加购 → 结算 → 订单 → 退款/改地址」全流程。
export interface Product {
  sku: string;
  name: string;
  price: number;
  icon: string;
  spec: string;
  tag?: string;
}

export const PRODUCTS: Product[] = [
  { sku: 'SKU-8801', name: '无线降噪耳机', price: 899, icon: '🎧', spec: '主动降噪 · 40 小时续航', tag: '热卖' },
  { sku: 'SKU-8802', name: '机械键盘 87 键', price: 459, icon: '⌨️', spec: '热插拔 · 茶轴 · 三模', tag: '码字首选' },
  { sku: 'SKU-8803', name: '便携咖啡机', price: 329, icon: '☕', spec: '胶囊 / 咖啡粉两用', tag: '新上架' },
  { sku: 'SKU-8804', name: '显示器支架', price: 199, icon: '🖥️', spec: '气弹簧 · 17–32 寸', tag: '' },
  { sku: 'SKU-8805', name: '护眼台灯', price: 249, icon: '💡', spec: '无频闪 · 色温可调', tag: '' },
  { sku: 'SKU-8806', name: '原木收纳托盘', price: 79, icon: '🧺', spec: '三格 · 桌面收纳', tag: '' },
];

/** 演示账号：面试官不用注册，直接一键登录。 */
export const ACCOUNTS = [
  { phone: '13800000001', password: '123456', name: '张同学' },
  { phone: '13800000002', password: '123456', name: '李同学' },
];
