<map version="1.0.1">
<!-- 由 Markdown Mindmap 导出；FreeMind / Freeplane 可直接打开 -->
<node TEXT="机器学习与深度学习">
  <richcontent TYPE="NOTE"><html><head></head><body><p>一门课的知识树：中心 → 板块 → 具体方法</p></body></html></richcontent>
  <node TEXT="数据" POSITION="right">
    <node TEXT="收集与清洗"/>
    <node TEXT="特征工程"/>
    <node TEXT="训练集 / 验证集 / 测试集">
      <richcontent TYPE="NOTE"><html><head></head><body><p>验证集用来选模型，测试集只在最后用一次</p></body></html></richcontent>
    </node>
  </node>
  <node TEXT="监督学习" POSITION="left">
    <node TEXT="线性回归"/>
    <node TEXT="逻辑回归"/>
    <node TEXT="决策树与随机森林"/>
    <node TEXT="支持向量机"/>
  </node>
  <node TEXT="无监督学习" POSITION="right">
    <node TEXT="聚类（K-means）"/>
    <node TEXT="降维（PCA / t-SNE）"/>
  </node>
  <node TEXT="深度学习" POSITION="left">
    <node TEXT="多层感知机"/>
    <node TEXT="卷积网络（图像）"/>
    <node TEXT="循环网络与 Transformer（序列）"/>
  </node>
  <node TEXT="评估与部署" POSITION="right">
    <node TEXT="指标：准确率、召回率、F1"/>
    <node TEXT="过拟合与正则化"/>
    <node TEXT="模型上线与监控"/>
  </node>
</node>
</map>
