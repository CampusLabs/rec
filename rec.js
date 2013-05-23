(function () {
  'use strict';

  // Store a local reference to jQuery and Underscorea.
  var $ = window.jQuery;
  var _ = window._;
  var Backbone = window.Backbone;

  // Delay a callback `n` ms or invoke immediately if 0.
  var delay = function (cb, n) { return !n ? cb() : _.delay(cb, n); };

  window.Rec = Backbone.View.extend({

    // How long since the last keystroke should rec wait to call `fetch`?
    delay: 250,

    // How many results should be displayed? `0` means as many as are returned
    // by `fetch`.
    limit: 0,

    // Should the second selectable item be automatically selected? In other
    // words, will hitting return fire the first recommended result or the broad
    // result?
    selectSecond: false,

    // Should the results be hidden and focus blurred when a result is clicked?
    hideOnClick: false,

    // Should the input be cleared when a result is clicked?
    clearOnClick: true,

    // The query string key that will be used with the default `fetch` method.
    queryKey: 'q',

    // Should rec attempt to fetch query results for an empty string?
    fetchNothing: false,

    // The keys that should move the selection prev/next.
    keyDirMap: {'38': 'prev', '40': 'next'},

    // The keys that should move the selection prev/next while CTRL is pressed.
    ctrlKeyDirMap: {'80': 'prev', '78': 'next'},

    // Define a Backbone collection to use for storing results.
    Collection: Backbone.Collection,

    // Override these template functions to return your labels and results the
    // way you want them. If you are not using the `groupBy` option,
    // `labelTemplate` will be ignored.
    labelTemplate: function (label) { return '<div>' + label + '</div>'; },
    resultTemplate: function (result) { return '<div>' + result + '</div>'; },

    // Define our DOM events. Note the special `.js-rec-input` and `.js-rec-
    // seletable` classes. Use these classes in your DOM structure as you see
    // fit.
    events: {
      'mouseover': 'onMouseover',
      'mouseout': 'onMouseout',
      'focus .js-rec-input': 'onInputFocus',
      'keydown .js-rec-input': 'onInputKeydown',
      'blur .js-rec-input': 'onInputBlur',
      'mouseover .js-rec-selectable': 'onSelectableMouseover',
      'click .js-rec-selectable': 'onSelectableClick'
    },

    initialize: function (options) {

      // Extend the options onto the view instance for conveinience.
      _.extend(this, options);

      // Create a cache object to store results.
      this.cache = {};

      // Track concurrent fetches for showing/hiding the loading spinner.
      this.fetchQueue = 0;
    },

    // Toggle the hover flag.
    onMouseover: function () { this.hover = true; },

    // Toggle the hover flag, hide if necessary.
    onMouseout: function () {
      this.hover = false;
      _.defer(_.bind(function () {
        if (!this.focus && !this.hover) this.hide();
      }, this));
    },

    // Update the `focus` flag and show the latest query results.
    onInputFocus: function (ev) {
      this.focus = true;
      this.query($(ev.currentTarget).val()).show();
    },

    // Check for the up/down keys and enter key, and finally submit a new
    // query.
    onInputKeydown: function (ev) {
      var key = ev.which;
      var dir = this.keyDirMap[key] || (ev.ctrlKey && this.ctrlKeyDirMap[key]);
      if (dir) {
        this[dir]();
        return ev.preventDefault();
      }
      if (key === 13) {
        var selected = this.$el.find('.js-rec-selected')[0];
        if (selected && selected !== ev.currentTarget) {
          selected.click();
          return ev.preventDefault();
        }
      }
      var $input = $(ev.currentTarget);
      if (key === 27) {
        $input.blur();
        this.hide();
        return ev.preventDefault();
      }
      _.defer(_.bind(function () { this.query($input.val()); }, this));
    },

    // Hide the results when focus is lost.
    onInputBlur: function () {
      this.focus = false;
      if (!this.hover) this.hide();
    },

    // Select the result that is being hovered over.
    onSelectableMouseover: function (ev) { this.select($(ev.currentTarget)); },

    // Optionally clear and hide the input and results on result click.
    onSelectableClick: function (ev) {
      var $input = this.$el.find('.js-rec-input');
      if (ev.currentTarget === $input[0]) return;
      this.trigger('action', ev, $(ev.currentTarget).data('recResult'));
      if (this.clearOnClick) $input.val('').focus();
      if (this.hideOnClick) {
        $input.blur();
        this.hide();
      }
    },

    // Parse the query before sending it to `fetch`. This allows you to clean up
    // bad characters, extra spaces, etc...
    parse: function (q) {
      return q.replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '').toLowerCase();
    },

    // `filter` works alongside `cache` to intelligently predict possible
    // results while waiting for a server request to come back. Override this
    // function with logic that best matches your server's filter logic.
    filter: function (q, result) {
      var str = _.values(result.toJSON()).join(' ').toLowerCase();
      return _.every(q.split(' '), function (w) { return ~str.indexOf(w); });
    },

    // The default `fetch` is designed for simple, JSON AJAX requests. Override
    // this function to suite your application's needs.
    fetch: function (q, cb) {
      var options = this.fetchOptions || {};
      (options.data || (options.data = {}))[this.queryKey] = q;
      return $.ajax(_.extend({
        type: 'get',
        dataType: 'json',
        success: function (results) { cb(null, results); },
        error: function (xhr) { cb(xhr.responseText); }
      }, options));
    },

    // Submit a new query for results. This shouldn't need to be modified or
    // called manually.
    query: function (q) {

      // Parse the raw query string.
      q = this.parse(q);

      // Compare to the last query and store so we don't waste any time.
      if (q === this.lastQ) return this;
      this.lastQ = q;

      // Clear the old `fetch` request if one was about to fire.
      if (this.timeout) {
        clearTimeout(this.timeout);
        this.timeout = null;
        if (!--this.fetchQueue) this.$el.removeClass('js-rec-loading');
      }

      // Looked for a cache result before trying to load.
      if (!this.cache[q] && (q || this.fetchEmptyQuery)) {

        // Add the loading class.
        ++this.fetchQueue;
        this.$el.addClass('js-rec-loading');

        // Start a timeout to `fetch`
        var self = this;
        this.timeout = delay(function () {
          self.timeout = null;
          self.fetch(q, function (er, results, temp) {
            if (!temp && !--self.fetchQueue) {
              self.$el.removeClass('js-rec-loading');
            }
            self.cache[q] = new self.Collection(results);
            self.render();
          });
        }, this.delay);
      }
      return this.render();
    },

    show: function () {
      this.$el.addClass('js-rec-active');
      this.select();
      return this;
    },

    hide: function () {
      this.$el.removeClass('js-rec-active');
      return this;
    },

    select: function ($el) {
      this.$el.find('.js-rec-selected').removeClass('js-rec-selected');
      if (!$el) {
        var $selectable = this.$el.find('.js-rec-selectable:visible');
        var i = Math.min(this.selectSecond ? 1 : 0, $selectable.length - 1);
        $el = $selectable.eq(i);
      }
      $el.addClass('js-rec-selected');
      return this;
    },

    dir: function (step) {
      var $selectable = this.$el.find('.js-rec-selectable:visible');
      var $selected = $selectable.filter('.js-rec-selected');
      var i = _.indexOf($selectable, $selected[0]);
      if (i === -1) return this.select($selectable.first());
      i += step;
      if (i === -1 || i === $selectable.length) return this;
      return this.select($selectable.eq(i));
    },

    prev: function () { this.dir(-1); },

    next: function () { this.dir(1); },

    getResults: function (q) {
      var cached;
      for (var i = q.length; i > 0; --i) {
        if (cached = this.cache[q.slice(0, i)]) break;
      }
      var matches = cached ? cached.filter(_.bind(this.filter, this, q)) : [];
      return new this.Collection(matches);
    },

    // Build the elements for the most recent query.
    render: function () {
      var q = this.lastQ;
      var results = this.getResults(q);
      this.$el
        .toggleClass('js-rec-nothing', q === '')
        .removeClass('js-rec-no-results')
        .find('.js-rec-result, .js-rec-label').remove();
      var $results = this.$el.find('.js-rec-results');
      if (results.length) {
        results = this.limit ? results.first(this.limit) : results.models;
        results = _.groupBy(results, this.groupBy || 'undefined');
        _.each(results, function (results, label) {
          if (label !== 'undefined') $results.append(this.renderLabel(label));
          _.each(results, function (result) {
            $results.append(this.renderResult(result));
          }, this);
        }, this);
      } else if (this.cache[q]) {
        this.$el.addClass('js-rec-no-results');
      }
      return this.select();
    },

    renderLabel: function (label) {
      var el = this.labelTemplate(label);
      return (el instanceof $ ? el : $(el)).addClass('js-rec-label');
    },

    renderResult: function (result) {
      var el = this.resultTemplate(result);
      return (el instanceof $ ? el : $(el))
        .addClass('js-rec-result js-rec-selectable')
        .data('recResult', result);
    }
  });
})();
