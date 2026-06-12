const recommendationMock = {
  success: true,
  graph: {
    nodes: [
      { id: 'root', title: '大数据概论', summary: '推荐路径统一从课程核心出发，再进入不同的补强主线。' },
      { id: 'etl', title: '数据获取与 ETL', summary: '先补齐数据采集、清洗和装载流程，作为后续存储与计算链路的公共前置。' },
      { id: 'hdfs', title: 'HDFS 基础', summary: '这条路线偏向先理解分布式存储，再过渡到统一计算框架。' },
      { id: 'hbase', title: 'HBase 建模', summary: '这条路线偏向先补齐 NoSQL 与列式存储建模，再进入实时处理。' },
      { id: 'mapreduce', title: 'MapReduce', summary: '这条路线偏向先建立离线批处理思维，再迁移到 Spark。' },
      { id: 'spark', title: 'Spark 架构', summary: '多条路线都会汇聚到 Spark，作为统一处理与优化的收束节点。' },
      { id: 'project', title: '综合项目实战', summary: '所有推荐路线最终都落到同一个项目实践终点，用来闭环前面补强的知识链。' },
    ],
    edges: [
      { edge_id: 'root->etl', source: 'root', target: 'etl' },
      { edge_id: 'etl->hdfs', source: 'etl', target: 'hdfs' },
      { edge_id: 'etl->hbase', source: 'etl', target: 'hbase' },
      { edge_id: 'etl->mapreduce', source: 'etl', target: 'mapreduce' },
      { edge_id: 'hdfs->spark', source: 'hdfs', target: 'spark' },
      { edge_id: 'hbase->spark', source: 'hbase', target: 'spark' },
      { edge_id: 'mapreduce->spark', source: 'mapreduce', target: 'spark' },
      { edge_id: 'spark->project', source: 'spark', target: 'project' },
    ],
  },
  candidates: [
    {
      id: 'route-1',
      path: ['root', 'etl', 'hdfs', 'spark', 'project'],
      selected: true,
      rank: 1,
    },
    {
      id: 'route-2',
      path: ['root', 'etl', 'hbase', 'spark', 'project'],
      selected: false,
      rank: 2,
    },
    {
      id: 'route-3',
      path: ['root', 'etl', 'mapreduce', 'spark', 'project'],
      selected: false,
      rank: 3,
    },
  ],
  selected: [
    {
      id: 'route-1-selected',
      path: ['root', 'etl', 'hdfs', 'spark', 'project'],
      selected: true,
      rank: 1,
    },
  ],
  best_path: {
    path: ['root', 'etl', 'hdfs', 'spark', 'project'],
    selected: true,
  },
  error_message: '',
  error_code: '',
  meta: {
    source: 'recommendation_mock',
  },
};

export default recommendationMock;
