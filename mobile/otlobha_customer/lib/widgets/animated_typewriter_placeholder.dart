import 'dart:async';
import 'package:flutter/material.dart';

const List<String> kOtlobhaSearchPlaceholders = [
  'قهوتك ناقصها حاجة حلوة؟ ابحث...',
  'جهّز لمة العيلة.. ابحث عن...',
  'نفسك في إيه انهاردة؟ ابحث...',
  'ابحث عن...',
];

/// Splits Arabic text into visual grapheme units so combining diacritics
/// (such as shadda in "جهّز") stay attached to their base character.
List<String> _splitArabicGraphemes(String text) {
  final units = <String>[];
  for (final rune in text.runes) {
    final ch = String.fromCharCode(rune);
    final isCombining = (rune >= 0x064B && rune <= 0x065F) || rune == 0x0670;
    if (isCombining && units.isNotEmpty) {
      units[units.length - 1] = '${units[units.length - 1]}$ch';
    } else {
      units.add(ch);
    }
  }
  return units;
}

/// Manages an Arabic RTL typewriter placeholder loop with full focus/input pause
/// and deterministic Timer cancellation to prevent leaks.
class TypewriterPlaceholderController extends ChangeNotifier {
  final List<List<String>> _phrases;
  final Duration typeSpeed;
  final Duration deleteSpeed;
  final Duration holdDuration;
  final Duration betweenPhrases;
  final String pausedText;

  FocusNode? _focusNode;
  TextEditingController? _textController;

  Timer? _timer;
  int _phraseIndex = 0;
  int _charCount = 0;
  bool _deleting = false;
  bool _active = true;
  bool _disposed = false;
  String _currentText = '';

  TypewriterPlaceholderController({
    List<String> phrases = kOtlobhaSearchPlaceholders,
    this.typeSpeed = const Duration(milliseconds: 65),
    this.deleteSpeed = const Duration(milliseconds: 30),
    this.holdDuration = const Duration(milliseconds: 1500),
    this.betweenPhrases = const Duration(milliseconds: 260),
    this.pausedText = 'ابحث عن...',
    FocusNode? focusNode,
    TextEditingController? textController,
    bool autoStart = true,
  }) : _phrases = phrases
            .map(_splitArabicGraphemes)
            .where((u) => u.isNotEmpty)
            .toList() {
    _focusNode = focusNode;
    _textController = textController;
    _focusNode?.addListener(_handleFieldStateChanged);
    _textController?.addListener(_handleFieldStateChanged);

    if (autoStart) {
      _syncActiveState();
    } else {
      _active = false;
    }
  }

  String get displayText => _active ? _currentText : pausedText;
  bool get isAnimating => _active;

  void _handleFieldStateChanged() {
    if (_disposed) return;
    _syncActiveState();
  }

  void setActive(bool shouldRun) {
    if (_disposed) return;
    if (shouldRun) {
      _startIfNeeded();
    } else {
      _stopAndReset();
    }
  }

  void _syncActiveState() {
    final isFocused = _focusNode?.hasFocus ?? false;
    final hasText = (_textController?.text ?? '').isNotEmpty;
    final shouldRun = !isFocused && !hasText && _phrases.isNotEmpty;
    if (shouldRun) {
      _startIfNeeded();
    } else {
      _stopAndReset();
    }
  }

  void _startIfNeeded() {
    if (_disposed || _phrases.isEmpty) return;
    if (_active && _timer != null) return;
    _active = true;
    _charCount = 0;
    _deleting = false;
    _currentText = '';
    _schedule(typeSpeed);
    notifyListeners();
  }

  void _stopAndReset() {
    _timer?.cancel();
    _timer = null;
    final wasActive = _active;
    final hadText = _currentText.isNotEmpty;
    _active = false;
    _charCount = 0;
    _deleting = false;
    _currentText = '';
    if (!_disposed && (wasActive || hadText)) {
      notifyListeners();
    }
  }

  void _schedule(Duration delay) {
    _timer?.cancel();
    if (_disposed || !_active || _phrases.isEmpty) return;
    _timer = Timer(delay, _step);
  }

  void _step() {
    if (_disposed || !_active || _phrases.isEmpty) return;
    final units = _phrases[_phraseIndex % _phrases.length];

    if (!_deleting) {
      _charCount += 1;
      if (_charCount > units.length) _charCount = units.length;
      _currentText = units.sublist(0, _charCount).join();
      notifyListeners();

      if (_charCount >= units.length) {
        _deleting = true;
        _schedule(holdDuration);
      } else {
        _schedule(typeSpeed);
      }
    } else {
      _charCount -= 1;
      if (_charCount < 0) _charCount = 0;
      _currentText = units.sublist(0, _charCount).join();
      notifyListeners();

      if (_charCount <= 0) {
        _deleting = false;
        _phraseIndex = (_phraseIndex + 1) % _phrases.length;
        _schedule(betweenPhrases);
      } else {
        _schedule(deleteSpeed);
      }
    }
  }

  @override
  void dispose() {
    _disposed = true;
    _timer?.cancel();
    _timer = null;
    _focusNode?.removeListener(_handleFieldStateChanged);
    _textController?.removeListener(_handleFieldStateChanged);
    super.dispose();
  }
}

/// Self-contained RTL typewriter text widget for clickable search bars (e.g., Home).
/// Keeps fixed single-line height and zero horizontal layout shift for sibling widgets.
class AnimatedTypewriterPlaceholderText extends StatefulWidget {
  final List<String> phrases;
  final TextStyle style;
  final Color cursorColor;
  final bool active;

  const AnimatedTypewriterPlaceholderText({
    super.key,
    this.phrases = kOtlobhaSearchPlaceholders,
    required this.style,
    this.cursorColor = const Color(0xFFA92224),
    this.active = true,
  });

  @override
  State<AnimatedTypewriterPlaceholderText> createState() =>
      _AnimatedTypewriterPlaceholderTextState();
}

class _AnimatedTypewriterPlaceholderTextState
    extends State<AnimatedTypewriterPlaceholderText> {
  late final TypewriterPlaceholderController _ctrl;

  @override
  void initState() {
    super.initState();
    _ctrl = TypewriterPlaceholderController(
      phrases: widget.phrases,
      autoStart: widget.active,
    );
  }

  @override
  void didUpdateWidget(covariant AnimatedTypewriterPlaceholderText oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.active != widget.active) {
      _ctrl.setActive(widget.active);
    }
  }

  @override
  void dispose() {
    _ctrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _ctrl,
      builder: (context, _) {
        final text = _ctrl.displayText;
        return SizedBox(
          width: double.infinity,
          child: Text.rich(
            TextSpan(
              children: [
                TextSpan(text: text.isEmpty ? '\u200B' : text),
                if (_ctrl.isAnimating)
                  TextSpan(
                    text: '|',
                    style: widget.style.copyWith(
                      color: widget.cursorColor.withOpacity(0.75),
                      fontWeight: FontWeight.w400,
                    ),
                  ),
              ],
            ),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            textDirection: TextDirection.rtl,
            textAlign: TextAlign.right,
            style: widget.style,
          ),
        );
      },
    );
  }
}
