/* 古诗文背诵学习系统 —— 题库读取层
   把 junior.js / senior.js 的原始数组整理成统一结构，并提供查询接口。
   页面与出题逻辑只依赖这里的接口，方便以后继续扩充题库。 */
(function (global) {
  'use strict';

  var Utils = global.PoetryUtils;
  var Meta = global.PoetryMeta || { genres: [], sourceTypes: [] };
  var problems = [];
  var rawTotal = 0;

  /** 把“年级 / 课程模块”统一成数组：支持 grade 单值 + grades 多年级（如《孟子》三则） */
  function gradeList(poem) {
    var list = Utils.toArray(poem.grades)
      .filter(function (item) {
        return typeof item === 'string' && item.trim();
      })
      .map(function (item) {
        return item.trim();
      });
    if (!list.length) {
      var single = String(poem.grade || '').trim();
      if (single) list = [single];
    }
    return Utils.unique(list);
  }

  /** 查询参数既支持单个值，也支持多选数组 */
  function toList(value) {
    if (Array.isArray(value)) {
      return value.filter(function (item) {
        return typeof item === 'string' && item;
      });
    }
    return value ? [String(value)] : [];
  }

  /** 单选字段（体裁 / 来源）也支持多选：命中任意一个即可 */
  function matchesAny(value, wanted) {
    var list = toList(wanted);
    if (!list.length) return true;
    return list.indexOf(value) !== -1;
  }

  function normalize(raw, index) {
    var poem = raw && typeof raw === 'object' ? raw : {};
    var title = String(poem.title || '').trim();
    var text = String(poem.text || '').trim();
    var id = String(poem.id || '').trim() || 'poem-' + index;
    var stage = poem.stage === '高中' ? '高中' : '初中';
    var grades = gradeList(poem);

    return {
      id: id,
      title: title,
      author: String(poem.author || '佚名').trim(),
      dynasty: String(poem.dynasty || '不详').trim(),
      stage: stage,
      grade: String(poem.grade || grades.join('、') || (stage === '初中' ? '初中' : '高中')).trim(),
      grades: grades,
      genre: String(poem.genre || '其他').trim(),
      sourceType: String(poem.sourceType || '拓展').trim(),
      required: !!poem.required,
      recommended: poem.recommended !== false,
      text: text,
      // 逐句现代汉语翻译：严格对应 Utils.splitSentences(text)，长度不一致时按“缺翻译”处理
      translations: Utils.toArray(poem.translation).filter(function (item) {
        return typeof item === 'string';
      }),
      // 考试重点标记：只存句子下标，正文（text）绝对不含 ★ 等标记符号
      examFocus: Utils.toArray(poem.examFocus).filter(function (item) {
        return item && typeof item === 'object' && typeof item.index === 'number' && isFinite(item.index);
      }),
      // 中心思想 / 主旨（文章级信息，一句话到三句话）
      summary: String(poem.summary || '').trim(),
      source: String(poem.source || '').trim(),
      notes: String(poem.notes || '').trim(),
      highlights: Utils.toArray(poem.highlights).filter(function (item) {
        return item && typeof item.text === 'string' && item.text.trim();
      }),
      variants: Utils.toArray(poem.variants).filter(function (item) {
        return item && typeof item.text === 'string' && item.text.trim();
      }),
      tags: Utils.toArray(poem.tags).filter(function (tag) {
        return typeof tag === 'string' && tag;
      }),
      order: index,
    };
  }

  function build() {
    var rawAll = Utils.toArray(global.POETRY_JUNIOR).concat(Utils.toArray(global.POETRY_SENIOR));
    rawTotal = rawAll.length;
    var seen = Object.create(null);
    var rawSeen = Object.create(null);
    var poems = [];

    /* 原始数据层先查一遍：normalize 遇到重复 id 会自动改名以保证页面可用，
       但不能因此掩盖“题库文件里 id 真的重复了”这个错误，这里单独记录下来。 */
    rawAll.forEach(function (raw, index) {
      var rawId = String((raw && raw.id) || '').trim();
      if (!rawId) {
        problems.push('第 ' + (index + 1) + ' 条数据在原始数据层缺少 id。');
        return;
      }
      if (rawSeen[rawId]) problems.push('原始数据 id 重复：' + rawId + '（第 ' + (index + 1) + ' 条）。');
      rawSeen[rawId] = true;
    });

    rawAll.forEach(function (raw, index) {
      var poem = normalize(raw, index);
      if (!poem.title || !poem.text) {
        problems.push('第 ' + (index + 1) + ' 条数据缺少标题或正文，已跳过。');
        return;
      }
      if (seen[poem.id]) {
        problems.push('篇目 id 重复：' + poem.id + '（' + poem.title + '），已自动改名。');
        poem.id = poem.id + '-' + (index + 1);
      }
      seen[poem.id] = true;
      poems.push(poem);
    });

    if (problems.length) {
      // 只在控制台提示，不影响页面运行
      console.warn('[题库] ' + problems.join('\n'));
    }
    return poems;
  }

  var poems = build();

  function byId(id) {
    for (var i = 0; i < poems.length; i += 1) {
      if (poems[i].id === id) return poems[i];
    }
    return null;
  }

  function byStage(stage) {
    return poems.filter(function (poem) {
      return poem.stage === stage;
    });
  }

  function countBy(list, key) {
    var map = Object.create(null);
    list.forEach(function (item) {
      var value = item[key];
      map[value] = (map[value] || 0) + 1;
    });
    return map;
  }

  /** 依据筛选条件查询篇目（全部条件都可为空） */
  function query(options) {
    var opts = options || {};
    var keyword = String(opts.keyword || '').trim().toLowerCase();

    return poems.filter(function (poem) {
      if (opts.stage && poem.stage !== opts.stage) return false;
      var wantedGrades = toList(opts.grade);
      if (wantedGrades.length && !wantedGrades.some(function (grade) {
        return poem.grades.indexOf(grade) !== -1;
      })) return false;
      if (!matchesAny(poem.genre, opts.genre)) return false;
      if (!matchesAny(poem.sourceType, opts.sourceType)) return false;
      if (opts.onlyRequired && !poem.required) return false;
      if (opts.onlySelected && Utils.toArray(opts.selectedIds).indexOf(poem.id) === -1) return false;
      if (opts.ids && Utils.toArray(opts.ids).indexOf(poem.id) === -1) return false;
      if (keyword) {
        var haystack = [poem.title, poem.author, poem.dynasty, poem.grade, poem.genre, poem.sourceType, poem.notes]
          .join(' ')
          .toLowerCase();
        var inText = poem.text.toLowerCase().indexOf(keyword) !== -1;
        if (haystack.indexOf(keyword) === -1 && !inText) return false;
      }
      return true;
    });
  }

  /** 年级展示顺序（按 Meta 中的设置，找不到的排在最后） */
  function gradeOrder(stage) {
    var list = (Meta.grades && Meta.grades[stage]) || [];
    return list.slice();
  }

  function sortPoems(list) {
    return list.slice().sort(function (a, b) {
      if (a.stage !== b.stage) return a.stage === '初中' ? -1 : 1;
      var order = gradeOrder(a.stage).concat(gradeOrder(b.stage));
      var oa = 99;
      var ob = 99;
      (a.grades.length ? a.grades : [a.grade]).forEach(function (grade) {
        var index = order.indexOf(grade);
        if (index !== -1 && index < oa) oa = index;
      });
      (b.grades.length ? b.grades : [b.grade]).forEach(function (grade) {
        var index = order.indexOf(grade);
        if (index !== -1 && index < ob) ob = index;
      });
      if (oa !== ob) return oa - ob;
      if (a.sourceType !== b.sourceType) {
        var sa = ['课标推荐', '统编教材', '上海地区', '拓展'].indexOf(a.sourceType);
        var sb = ['课标推荐', '统编教材', '上海地区', '拓展'].indexOf(b.sourceType);
        return (sa === -1 ? 9 : sa) - (sb === -1 ? 9 : sb);
      }
      return a.order - b.order;
    });
  }

  /**
   * 逐句翻译，与 Utils.splitSentences(poem.text) 的下标严格一一对应。
   * 缺翻译的位置返回空字符串（页面据此不显示翻译文字，但布局占位仍然保留）。
   */
  function translationLines(poem) {
    var sentences = Utils.splitSentences(poem ? poem.text : '');
    var list = Utils.toArray(poem ? poem.translations : []);
    return sentences.map(function (_, index) {
      var line = list[index];
      return typeof line === 'string' ? line.trim() : '';
    });
  }

  /**
   * 考试重点标记：返回 { 句子下标: { reason } }。
   * 只保留落在正文句数范围内的下标（越界数据被静默忽略，页面不会报错），
   * 页面据此决定该句的 marker 里有没有 ★，与正文文本完全解耦。
   */
  function examFocusMap(poem) {
    var total = Utils.splitSentences(poem ? poem.text : '').length;
    var map = Object.create(null);
    Utils.toArray(poem ? poem.examFocus : []).forEach(function (item) {
      if (!item || typeof item.index !== 'number' || !isFinite(item.index)) return;
      var index = Math.floor(item.index);
      if (index < 0 || index >= total) return;
      map[index] = { reason: typeof item.reason === 'string' ? item.reason.trim() : '' };
    });
    return map;
  }

  /**
   * 名句标记：返回 { 句子下标: true }。
   * 数据里的「名句」提示可能是单句、跨句或句中片段，这里用去标点后的子串关系判断：
   * 句子包含提示，或提示包含整句，都算这一句和名句有关。
   */
  function nameSentenceMap(poem) {
    var sentences = Utils.splitSentences(poem ? poem.text : '');
    var names = Utils.toArray(poem ? poem.highlights : [])
      .filter(function (item) {
        return item && (item.type === '名句' || item.type === '关键词') && typeof item.text === 'string';
      })
      .map(function (item) {
        return Utils.normalizeText(item.text);
      })
      .filter(Boolean);
    var map = Object.create(null);
    if (!names.length) return map;
    sentences.forEach(function (sentence, index) {
      var text = Utils.normalizeText(sentence);
      if (!text) return;
      var hit = names.some(function (name) {
        return name.indexOf(text) !== -1 || text.indexOf(name) !== -1;
      });
      if (hit) map[index] = true;
    });
    return map;
  }

  function highlightMap(poem) {
    var map = Object.create(null);
    Utils.toArray(poem.highlights).forEach(function (item) {
      var type = item.type || '名句';
      if (!map[type]) map[type] = [];
      map[type].push(item);
    });
    return map;
  }

  global.PoetryDatabase = {
    rawCount: function () {
      return rawTotal;
    },
    all: function () {
      return poems.slice();
    },
    byId: byId,
    byStage: byStage,
    query: query,
    sort: sortPoems,
    countBy: countBy,
    gradeOrder: gradeOrder,
    highlightMap: highlightMap,
    translationLines: translationLines,
    examFocusMap: examFocusMap,
    nameSentenceMap: nameSentenceMap,
    stats: function (stage) {
      var list = stage ? byStage(stage) : poems.slice();
      return {
        total: list.length,
        required: list.filter(function (item) {
          return item.required;
        }).length,
        bySource: countBy(list, 'sourceType'),
        byGenre: countBy(list, 'genre'),
        byGrade: countBy(list, 'grade'),
      };
    },
    problems: problems,
  };
})(window);
