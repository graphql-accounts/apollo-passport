import 'regenerator-runtime/runtime';

import chai from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';

import jwt from 'jsonwebtoken';

import ApolloPassport from './index';
import { defaultMapUserToJWTProps, defaultCreateTokenFromUser } from './index';

import { FakeResolve, FakeReject } from './test-utils/promises';

const should = chai.should();
chai.use(sinonChai);

const jwtSecret = 'xxx';
const requiredOptions = () => ({
  jwtSecret,
  db: { createUser: true, fetchUserByEmail: true },
  ROOT_URL: 'http://localhost:3000/'
});

describe('apollo-passport', () => {

  describe('default helpers', () => {

    describe('userId()', () => {
      let options, ap;

      options = requiredOptions();
      ap = new ApolloPassport(options);

      ap.userId({ id: 1 }).should.equal(1);
      ap.userId({ _id: 1 }).should.equal(1);
      ap.userId({ userId: 1 }).should.equal(1);

      options.db.mapUserToUserId = user => user.crazyId;
      ap = new ApolloPassport(options);

      ap.userId({ crazyId: 1 }).should.equal(1);
    });

    describe('setUserIdProp', () => {
      const ap = new ApolloPassport(requiredOptions());
      const user = {};
      ap.setUserIdProp(user, 1);
      user.id.should.equal(1);
    });

    describe('defaultMapUserToJWTProps', () => {
      const context = { userId: x => x.id };
      const map = defaultMapUserToJWTProps.bind(context);

      it('maps userId', () => {
        map({ id: 1 }).userId.should.equal(1);
      });

      it('maps displayName', () => {
        map({ displayName: 'a' }).displayName.should.equal('a');
        map({ username: 'a' }).displayName.should.equal('a');
        map({ services: { facebook: { displayName: 'a' }} }).displayName.should.equal('a');
        map({ emails: [ { address: 'a' } ] }).displayName.should.equal('a');
      })
    });

    describe('defaultCreateTokenFromUser', () => {
      it('x', () => {
        const context = {
          mapUserToJWTProps(user) { return { userId: user.id }; },
          jwtSecret
        };

        const user = { id: 1 };
        const token = defaultCreateTokenFromUser.call(context, user);

        const data = jwt.decode(token);
        delete data.iat;
        delete data.exp;
        data.should.deep.equal(context.mapUserToJWTProps(user));

      });
    });

  });

  describe('constructor()', () => {

    it('requires a valid db driver instance', () => {
      const options = requiredOptions();

      (function() {
        new ApolloPassport(options);
      }).should.not.throw();

      (function() {
        delete options.db;
        new ApolloPassport(options);
      }).should.throw();

      (function() {
        options.db = {};
        new ApolloPassport(options);
      }).should.throw();
    });

    it('throws on no jwtSecret', () => {
      const options = requiredOptions();
      delete options.jwtSecret;
      (function() {
        new ApolloPassport(options);
      }).should.throw();
    });

    describe('ROOT_URL', () => {

      it('throws on no ROOT_URL', () => {
        const options = requiredOptions();
        delete options.ROOT_URL;

        (function() {
          new ApolloPassport(options);
        }).should.throw();
      });

      it('accepts a ROOT_URL global', () => {
        const options = requiredOptions();
        delete options.ROOT_URL;
        global.ROOT_URL = 'ROOT_URL/';
        const ap = new ApolloPassport(options);
        ap.ROOT_URL.should.equal(ROOT_URL);
        delete global.ROOT_URL;
      });

      it('accepts process.env.ROOT_URL', () => {
        const options = requiredOptions();
        delete options.ROOT_URL;
        process.env.ROOT_URL = 'ROOT_URL/';
        const ap = new ApolloPassport(options);
        ap.ROOT_URL.should.equal(process.env.ROOT_URL);
        delete process.env.ROOT_URL;
      });

      it('appends trailing / if one does not exist', () => {
        const options = requiredOptions();
        options.ROOT_URL = 'ROOT_URL';
        const ap = new ApolloPassport(options);
        ap.ROOT_URL.should.equal('ROOT_URL/');
      });

    });

    it('strips leading "/" from authPath', () => {
      const options = requiredOptions();
      options.authPath = '/hello';
      const ap = new ApolloPassport(options);
      ap.authPath.should.equal('hello');
    });

  });

  describe('use()', () => {

    const ap = new ApolloPassport(requiredOptions());
    ap.passport = { use() { } };
    ap.require = function(strategy, module) {
      switch(module) {
        case 'index':
          return function() {};
        case 'resolvers':
          return { RootMutation: {} };
        case 'schema':
          return [ '' ];
        case 'verify':
          return function() { return { _defaultVerify: true, self: this }; };
        case 'defaultOptions':
          return { _defaultOptions: true };

        /* just to help with writing tests */
        /* istanbul ignore next */
        default:
          throw new Error("No " + module);
      }
    }

    it('accepts an AugmentedStrategy', () => {
      class AugmentedStrategy {
        constructor(apolloPassport, options) {
          this.ap = apolloPassport;

          function Strategy() {}
          this.strategy = new Strategy();

          this.resolvers = {};
          this.schema = [''];
        }
      }
      AugmentedStrategy.__isAugmented = true;

      ap.use('augmented', AugmentedStrategy);

      ap.strategies.augmented.should.be.an.instanceOf(AugmentedStrategy);
    });

    it('calls passport.use(new Strategy(options, boundVerify))', () => {
      const options = {};
      const verify = function() { return { self: this } };

      function FakeStrategy(options, boundVerify) {
        options.should.equal(options);
        boundVerify().self.should.equal(ap);
      }
      ap.use('local', FakeStrategy, options, verify)
    });

    it('accepts uses default options for missing options / verify', () => {
      function FakeStrategy1(options, boundVerify) {
        options.should.deep.equal({ _defaultOptions: true });
        boundVerify().should.deep.equal({ self: ap });
      }
      const verify = function() { return { self: this } };
      ap.use('local', FakeStrategy1, verify)

      function FakeStrategy2(options, boundVerify) {
        options.should.deep.equal({ _defaultOptions: true });
        boundVerify().should.deep.equal({ _defaultVerify: true, self: ap });
      }
      ap.use('local', FakeStrategy2);
    });

    it('sets default callbackURL on oauth methods', () => {
      function FakeStrategy(options) {
        options.callbackURL.should.equal(`${ap.authUrlRoot}/fake/callback`)
      }
      ap.use('oauth2:fake', FakeStrategy, {});
    });

    it('calls passport.authenticate if a scope is given', () => {
      const apOptions = requiredOptions();
      const authenticate = sinon.spy();
      apOptions.passport = { use() {}, authenticate };

      const ap = new ApolloPassport(apOptions);
      const scopeOptions = { scope: ['a'] };
      ap.use('fake', function() {}, scopeOptions, () => {});

      authenticate.should.have.been.calledWith('fake', scopeOptions);
    });
  });

  describe('extendsWith()', () => {
    it('extends the context', () => {
      const extensions = { a: 1 };
      const ap = new ApolloPassport(requiredOptions());
      ap.extendWith(extensions);
      ap.a.should.equal(1);
    });
  });

  /////////////////////////////
  // require() and resolve() //
  /////////////////////////////

  describe('resolve()', () => {
    const ap = new ApolloPassport(requiredOptions());
    (function () {
      ap.resolve({});  // expects a string
    }).should.throw();
  });

  describe('require()', () => {
    const es5name = './test-utils/sample-module-es5.js';
    const es5 = require(es5name);
    const es6name = './test-utils/sample-module-es6.js';
    const es6 = require(es6name);

    const ap = new ApolloPassport(requiredOptions());
    ap.resolve = function(module) {
      if (module.endsWith('es6'))
        return es6name;
      if (module.endsWith('es5'))
        return es5name;
      return null;
    };

    it('throws on unfound modules', () => {
      (function() {
        ap.require('non-existant', 'non-existant')
      }).should.throw();
    });

    it('returns a loaded, found module', () => {
      ap.require('local', 'es5').should.equal(es5);
      ap.require('local', 'es6').should.equal(es6.default);
    });

  });

  ///////////
  // Users //
  ///////////

  describe('users', () => {

    describe('createUser', () => {

      it('calls db.createUser and returns the userId', async () => {
        const desiredUserId = '1';

        const options = requiredOptions();
        options.db.createUser = () => Promise.resolve(desiredUserId);

        const ap = new ApolloPassport(options);
        const userId = await ap.createUser({});

        userId.should.equal(desiredUserId);
      });

    });

  });

  //////////////////////
  // GraphQL & Apollo //
  //////////////////////

  describe('schema()', () => {
    it('returns at least this._schema', () => {
      const ap = new ApolloPassport(requiredOptions());
      ap.schema()[0].replace(/\s/g, '')
        .should.equal(ap._schema[0].replace(/\s/g, ''));
    });
  });

  describe('resolvers()', () => {
    it('returns a bound version of this._resolvers', () => {
      const ap = new ApolloPassport(requiredOptions());
      ap._resolvers = { a: 1, RootMutation: {}, RootQuery: {} };
      ap._bindRootQueriesAndMutations = function(x) { return { ...x, _bound: 1 }; };
      ap.resolvers().should.deep.equal({ ...ap._resolvers, _bound: 1 });
    });
  });

  describe('wrapOptions() func', () => {

    const options = { a: 1 };
    const ap = new ApolloPassport(requiredOptions());
    const wrapper = ap.wrapOptions(options); // <-- returns async function!
    const reqAuthBearer = token => ({ headers: { authorization: `Bearer ${token}` }});

    it('returns the original options if no token in headers', async () => {
      (await wrapper({ headers: {} })).should.equal(options);

      (await wrapper({ headers: {
        authorization: 'Some unrecognized type'
      } })).should.equal(options);

      (await wrapper({ headers: {
        authorization: 'Bearer ' // empty token
      } })).should.equal(options);
    });

    // e.g. invalid token, jwt expired
    it('adds a jwtError to the context if one occurred', async () => {
      const token = jwt.sign({ userId: 1 }, 'a different secret');
      const result = await wrapper(reqAuthBearer(token));
      should.not.exist(result.context.auth);
      result.context.authError.name.should.equal('JsonWebTokenError');
      result.context.authError.message.should.equal('invalid signature');
    });

    it('adds the decoded value of a valid token to the context', async () => {
      const token = jwt.sign({ userId: 1 }, jwtSecret);
      const result = await wrapper(reqAuthBearer(token));
      result.context.auth.userId.should.equal(1);
    });
  });

  describe('_bindRootQueriesAndMutations()', () => {
    it('binds functions in RootMutations/RootQueries keys (only)', () => {
      const resolvers = {
        x() { return this; },
        RootMutation: {
          x() { return this; }
        },
        RootQuery: {
          x() { return this; }
        }
      };

      const ap = new ApolloPassport(requiredOptions());
      const bound = ap._bindRootQueriesAndMutations(resolvers);

      bound.x().should.not.equal(ap);
      bound.RootMutation.x().should.equal(ap);
      bound.RootQuery.x().should.equal(ap);
    });
  });

  /////////////////
  // Middlewares //
  /////////////////

  describe('middleware', () => {

    // honestly we should just skip this, or at least validate html
    it('popupScript', () => {
      const data = { a: 1 };
      const ap = new ApolloPassport(requiredOptions());
      const out = ap.popupScript(data);
      const matches = out.match(/postMessage\('apolloPassport (.*)', window.location/);
      JSON.parse(matches[1]).should.deep.equal(data);
    });

    describe('expressMiddleware()', () => {

      it('passes content', () => {
        const ap = new ApolloPassport(requiredOptions());
        ap.apAuthenticate = FakeResolve('data');
        ap.popupScript = () => 'popupScript';

        const middleware = ap.expressMiddleware();
        const req = { url: '/ap-auth/facebook/callback' };
        const res = { setHeader() {}, end: sinon.spy() };

        middleware(req, res);
        res.end.should.have.been.calledWith('popupScript', 'utf8');
      });

      it('handles errors', () => {
        const ap = new ApolloPassport(requiredOptions());
        ap.apAuthenticate = FakeReject(new Error('error'));

        const middleware = ap.expressMiddleware();
        const req = { url: '/ap-auth/facebook/callback' };
        const res = { status: sinon.spy(), end: sinon.spy() };

        middleware(req, res);
        res.status.should.have.been.calledWith(500, 'Internal server error');
        res.end.should.have.been.called;
      });

    });

  });

});
