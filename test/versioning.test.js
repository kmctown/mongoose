
/**
 * Test dependencies.
 */

var start = require('./common')
  , mongoose = start.mongoose
  , assert = require('assert')
  , random = require('../lib/utils').random
  , Schema = mongoose.Schema
  , VersionError = mongoose.Error.VersionError
  ;

/**
 * Setup.
 */

var Comments = new Schema();

Comments.add({
  title     : String
  , date      : Date
  , comments  : [Comments]
});

var BlogPost = new Schema({
  title     : String
  , date      : Date
  , meta      : {
    date      : Date
      , visitors  : Number
      , nested    : [Comments]
      , numbers   : [Number]
  }
  , mixed        : {}
  , numbers      : [Number]
  , comments     : [Comments]
  , arr          : []
  , dontVersionMe: []
}, { collection: 'versioning_' + random(), skipVersioning: { dontVersionMe: true } });


mongoose.model('Versioning', BlogPost);

describe('versioning', function() {
  it('is only added to parent schema (gh-1265)', function(done) {
    assert.ok(BlogPost.path('__v'));
    assert.ok(!BlogPost.path('comments').__v);
    assert.ok(!BlogPost.path('meta.nested').__v);
    done();
  });

  it('works', function(done) {
    var db = start()
      , V = db.model('Versioning');

    var doc = new V;
    doc.title = 'testing versioning';
    doc.date = new Date;
    doc.meta.date = new Date;
    doc.meta.visitors = 34;
    doc.meta.numbers = [12,11,10];
    doc.meta.nested = [
        { title: 'does it work?', date: new Date }
      , { title: '1', comments: [{ title: 'this is sub #1'},{ title: 'this is sub #2'}] }
      , { title: '2', comments: [{ title: 'this is sub #3'},{ title: 'this is sub #4'}] }
      , { title: 'hi', date: new Date }
    ];
    doc.mixed = { arr: [12,11,10] };
    doc.numbers = [3,4,5,6,7];
    doc.comments = [
        { title: 'comments 0', date: new Date }
      , { title: 'comments 1', comments: [{ title: 'comments.1.comments.1'},{ title: 'comments.1.comments.2'}] }
      , { title: 'coments 2', comments: [{ title: 'comments.2.comments.1'},{ title: 'comments.2.comments.2'}] }
      , { title: 'comments 3', date: new Date }
    ];
    doc.arr = [['2d']];

    doc.save(function(err) {
      var a , b;
      assert.ifError(err);
      // test 2 concurrent ops
      V.findById(doc, function(err, _a) {
        assert.ifError(err);
        a = _a;
        a && b && test1(a, b);
      });
      V.findById(doc, function(err, _b) {
        assert.ifError(err);
        b = _b;
        a && b && test1(a, b);
      });
    });

    function test1(a, b) {
      a.meta.numbers.push(9);
      b.meta.numbers.push(8);
      save(a, b, test2);
    }

    function test2(err, a, b) {
      assert.ifError(err);
      assert.equal(a.meta.numbers.length, 5);
      assert.equal(a._doc.__v, 2);
      a.meta.numbers.pull(10);
      b.meta.numbers.push(20);
      save(a, b, test3);
    }

    function test3(err, a, b) {
      assert.ifError(err);
      assert.equal(a.meta.numbers.length, 5);
      assert.equal(b.meta.numbers.length, 5);
      assert.equal(-1, a.meta.numbers.indexOf(10));
      assert.ok(~a.meta.numbers.indexOf(20));
      assert.equal(a._doc.__v, 4);

      a.numbers.pull(3, 20);

      // should fail
      b.set('numbers.2', 100);
      save(a, b, test4);
    }

    function test4(err, a, b) {
      assert.ok(/No matching document/.test(err), err);
      assert.equal(a._doc.__v, 5);
      a.set('arr.0.0', 'updated');
      var d = a.$__delta();
      assert.equal(a._doc.__v, d[0].__v, 'version should be added to where clause');
      assert.ok(!('$inc' in d[1]));
      save(a,b,test5);
    }

    function test5(err, a, b) {
      assert.ifError(err);
      assert.equal('updated', a.arr[0][0]);
      assert.equal(a._doc.__v, 5);
      a.set('arr.0', 'not an array');
      // should overwrite a's changes, last write wins
      b.arr.pull(10);
      b.arr.addToSet('using set');
      save(a, b, test6);
    }

    function test6(err, a, b) {
      assert.ifError(err);
      assert.equal(a.arr.length, 2);
      assert.equal('updated', a.arr[0][0]);
      assert.equal('using set', a.arr[1]);
      assert.equal(a._doc.__v, 6);
      b.set('arr.0', 'not an array');
      // should overwrite b's changes, last write wins
      // force a $set
      a.arr.pull('using set');
      a.arr.push('woot', 'woot2');
      a.arr.$pop();
      save(a, b, test7);
    }

    function test7(err,a,b) {
      assert.ok(/No matching document/.test(err), 'changes to b should not be applied');
      assert.equal(a.arr.length, 2);
      assert.equal('updated', a.arr[0][0]);
      assert.equal('woot', a.arr[1]);
      assert.equal(a._doc.__v, 7);
      a.meta.nested.$pop();
      b.meta.nested.$pop();
      save(a, b, test8);
    }

    function test8(err, a, b) {
      assert.ok(/No matching document/.test(err), 'changes to b should not be applied');
      assert.equal(a.meta.nested.length, 3);
      assert.equal(a._doc.__v, 8);
      a.meta.nested.push({ title: 'the' });
      a.meta.nested.push({ title: 'killing' });
      b.meta.nested.push({ title: 'biutiful' });
      save(a, b, test9);
    }

    function test9(err, a, b) {
      assert.ifError(err);
      assert.equal(6, a.meta.nested.length);
      assert.equal(a._doc.__v, 10);
      // nested subdoc property changes should not trigger version increments
      a.meta.nested[2].title = 'two';
      b.meta.nested[0].title = 'zero';
      b.meta.nested[1].comments[0].title = 'sub one';
      save(a,b, function(err, _a, _b) {
        assert.ifError(err);
        assert.equal(a._doc.__v, 10);
        assert.equal(b._doc.__v, 10);
        test10(null, _a, _b);
      });
    }

    function test10(err, a, b) {
      assert.ifError(err);
      assert.equal('two', b.meta.nested[2].title);
      assert.equal('zero', b.meta.nested[0].title);
      assert.equal('sub one', b.meta.nested[1].comments[0].title);
      assert.equal(a._doc.__v, 10);
      assert.equal(3, a.mixed.arr.length);
      a.mixed.arr.push([10],{x:1},'woot');
      a.markModified('mixed.arr');
      save(a, b, test11);
    }

    function test11(err, a, b) {
      assert.ifError(err);
      assert.equal(a._doc.__v, 11);
      assert.equal(6, a.mixed.arr.length);
      assert.equal(1, a.mixed.arr[4].x);
      assert.equal('woot', a.mixed.arr[5]);
      assert.equal(10, a.mixed.arr[3][0]);

      a.comments.addToSet({ title: 'monkey' });
      b.markModified('comments');

      var d = b.$__delta();
      assert.ok(d[1].$inc, 'a $set of an array should trigger versioning');

      save(a, b, test12);
    }

    function test12(err, a, b) {
      assert.ok(err instanceof VersionError);
      assert.ok(/No matching document/.test(err), 'changes to b should not be applied');
      assert.equal(5, a.comments.length);

      a.comments.addToSet({ title: 'aven' });
      a.comments.addToSet({ title: 'avengers' });
      var d = a.$__delta();

      assert.equal(undefined, d[0].__v, 'version should not be included in where clause');
      assert.ok(!d[1].$set);
      assert.ok(d[1].$addToSet);
      assert.ok(d[1].$addToSet.comments);

      a.comments.$shift();
      d = a.$__delta();
      assert.equal(12, d[0].__v, 'version should be included in where clause');
      assert.ok(d[1].$set, 'two differing atomic ops on same path should create a $set');
      assert.ok(d[1].$inc, 'a $set of an array should trigger versioning');
      assert.ok(!d[1].$addToSet);
      save(a, b, test13);
    }

    function test13(err, a, b) {
        assert.ifError(err);
        a.dontVersionMe.push('value1');
        b.dontVersionMe.push('value2');
        save(a, b, test14);
      }

    function test14(err, a) {
        assert.equal(a._doc.__v, 13, 'version should not be incremented for non-versioned fields');
        db.close();
        done();
      }

    function save(a, b, cb) {
      var e;
      // make sure that a saves before b
      a.save(function(err) {
        if (err) e = err;
        b.save(function(err) {
          if (err) e = err;
          lookup();
        });
      });
      function lookup() {
        var a1, b1;
        V.findById(a, function(err, a_) {
          if (err && !e) e = err;
          a1 = a_;
          a1 && b1 && cb(e, a1, b1);
        });
        V.findById(b, function(err, b_) {
          if (err && !e) e = err;
          b1 = b_;
          a1 && b1 && cb(e, a1, b1);
        });
      }
    }

  });

  it('versioning without version key', function(done) {
    var db = start()
      , V = db.model('Versioning');

    var doc = new V;
    doc.numbers = [3,4,5,6,7];
    doc.comments = [
        { title: 'does it work?', date: new Date }
      , { title: '1', comments: [{ title: 'this is sub #1'},{ title: 'this is sub #2'}] }
      , { title: '2', comments: [{ title: 'this is sub #3'},{ title: 'this is sub #4'}] }
      , { title: 'hi', date: new Date }
    ];

    doc.save(test);

    function test(err) {
      assert.ifError(err);
      // test getting docs back from db missing version key
      V.findById(doc).select('numbers comments').exec(function(err, doc) {
        db.close();
        assert.ifError(err);
        doc.comments[0].title = 'no version was included';
        var d = doc.$__delta();
        assert.ok(!d[0].__v, 'no version key was selected so should not be included');
        done();
      });
    }
  });

  it('version works with strict docs', function(done) {
    var db = start();
    var schema = new Schema({ str: ['string'] }, { strict: true, collection: 'versionstrict_' + random() });
    var M = db.model('VersionStrict', schema);
    var m = new M({ str: ['death', 'to', 'smootchy'] });
    m.save(function(err) {
      assert.ifError(err);
      M.find(m, function(err, m) {
        assert.ifError(err);
        assert.equal(1, m.length);
        m = m[0];
        assert.equal(0, m._doc.__v);
        m.str.pull('death');
        m.save(function(err) {
          assert.ifError(err);
          M.findById(m, function(err, m) {
            db.close();
            assert.ifError(err);
            assert.equal(1, m._doc.__v);
            assert.equal(2, m.str.length);
            assert.ok(!~m.str.indexOf('death'));
            done();
          });
        });
      });
    });
  });

  it('version works with existing unversioned docs', function(done) {
    var db = start()
      , V = db.model('Versioning');

    V.collection.insert({ title: 'unversioned', numbers: [1,2,3] }, {safe:true}, function(err) {
      assert.ifError(err);
      V.findOne({ title: 'unversioned' }, function(err, d) {
        assert.ifError(err);
        assert.ok(!d._doc.__v);
        d.numbers.splice(1, 1, 10);
        var o = d.$__delta();
        assert.equal(undefined, o[0].__v);
        assert.ok(o[1].$inc);
        assert.equal(1, o[1].$inc.__v);
        d.save(function(err, d) {
          assert.ifError(err);
          assert.equal(1, d._doc.__v);
          V.findById(d, function(err, d) {
            db.close();
            assert.ifError(err);
            assert.ok(d);
            done();
          });
        });
      });
    });
  });

  it('versionKey is configurable', function(done) {
    var db = start();
    var schema = new Schema(
        { configured: 'bool' }
      , { versionKey: 'lolwat', collection: 'configuredversion' + random() });
    var V = db.model('ConfiguredVersionKey', schema);
    var v = new V({ configured: true });
    v.save(function(err) {
      assert.ifError(err);
      V.findById(v, function(err, v) {
        db.close();
        assert.ifError(err);
        assert.equal(0, v._doc.lolwat);
        done();
      });
    });
  });

  it('can be disabled', function(done) {
    var db = start();
    var schema = Schema({ x: ['string'] }, { versionKey: false });
    var M = db.model('disabledVersioning', schema, 's' + random());
    M.create({ x: ['hi'] }, function(err, doc) {
      assert.ifError(err);
      assert.equal(false, '__v' in doc._doc);
      doc.x.pull('hi');
      doc.save(function(err) {
        assert.ifError(err);
        assert.equal(false, '__v' in doc._doc);

        doc.set('x.0', 'updated');
        var d = doc.$__delta()[0];
        assert.equal(undefined, d.__v, 'version should not be added to where clause');

        M.collection.findOne({ _id: doc._id }, function(err, doc) {
          assert.equal(false, '__v' in doc);
          db.close(done);
        });
      });
    });
  });

  it('works with numbericAlpha paths', function(done) {
    var db = start();
    var M = db.model('Versioning');
    var m = new M({ mixed: {} });
    var path = 'mixed.4a';
    m.set(path, 2);
    m.save(function(err) {
      assert.ifError(err);
      db.close(done);
    });
  });

  describe('doc.increment()', function() {
    it('works without any other changes (gh-1475)', function(done) {
      var db = start()
        , V = db.model('Versioning');

      var doc = new V;
      doc.save(function(err) {
        assert.ifError(err);
        assert.equal(0, doc.__v);

        doc.increment();

        doc.save(function(err) {
          assert.ifError(err);

          assert.equal(1, doc.__v);

          V.findById(doc, function(err, doc) {
            assert.ifError(err);
            assert.equal(1, doc.__v);
            db.close(done);
          });
        });
      });
    });
  });

  describe('versioning is off', function() {
    it('when { safe : false } is set (gh-1520)', function(done) {
      var schema1 = new Schema({ title : String}, { safe : false });
      assert.equal(schema1.options.versionKey, false);
      done();
    });
    it('when { safe : { w: 0 }} is set (gh-1520)', function(done) {
      var schema1 = new Schema({ title : String}, { safe : { w: 0 } });
      assert.equal(schema1.options.versionKey, false);
      done();
    });
  });

  it('gh-1898', function(done) {
    var db = start();
    var schema = new Schema({ tags: [String], name: String });

    var M = db.model('gh-1898', schema, 'gh-1898');

    var m = new M({ tags: ['eggs'] });

    m.save(function(err) {
      assert.ifError(err);

      m.tags.push('bacon');
      m.name = 'breakfast';
      m.tags[0] = 'eggs';
      m.markModified('tags.0');

      assert.equal(m.$__where(m.$__delta()[0]).__v, 0);
      assert.equal(m.$__delta()[1].$inc.__v, 1);
      db.close(done);
    });
  });

  it('can remove version key from toObject() (gh-2675)', function(done) {
    var db = start();
    var schema = new Schema({ name: String });
    var M = db.model('gh2675', schema, 'gh2675');

    var m = new M();
    m.save(function(err, m) {
      assert.ifError(err);
      var obj = m.toObject();
      assert.equal(0, obj.__v);
      obj = m.toObject({ versionKey: false });
      assert.equal(undefined, obj.__v);
      db.close(done);
    });
  });
});
