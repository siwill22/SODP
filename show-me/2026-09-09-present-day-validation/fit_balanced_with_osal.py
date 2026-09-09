"""
Follow-up to fit_with_osal.py: OSAL carries real signal for the
warm-water carbonate-vs-siliceous split (median 33.6 vs 34.8 PSU,
Mann-Whitney p=1.2e-39) but a plain additive fit still gets 0.0% on warm
siliceous-ooze, because the global 3-class fit is dominated by the
cold-water majority (siliceous-ooze overall is only ~14.5% of points, and
warm siliceous-ooze is a 12:1 minority within warm water specifically).
Isolated to the warm-only binary problem, OSAL+OVEL+margin already lifts
recall 0% -> 15% -- this tests whether class-weighting the *full* 3-class
fit (so the objective stops treating siliceous-ooze as globally rare)
recovers a similar gain in the actual deployed model, and what it costs
the other two classes.
"""
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import cross_val_predict, cross_val_score, StratifiedKFold
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import classification_report, accuracy_score

core = pd.read_csv('validation_points_with_osal.csv')
y = core['bucket'].values
cv = StratifiedKFold(n_splits=5, shuffle=True, random_state=0)


def evaluate(name, cols, class_weight):
    X = StandardScaler().fit_transform(core[cols].values)
    acc = cross_val_score(LogisticRegression(max_iter=2000, class_weight=class_weight), X, y, cv=cv, scoring='accuracy')
    pred = cross_val_predict(LogisticRegression(max_iter=2000, class_weight=class_weight), X, y, cv=cv)
    print(f'\n=== {name} ===')
    print(f'overall 5-fold CV accuracy: {acc.mean():.1%} +/- {acc.std():.1%}')
    print(classification_report(y, pred, digits=3))

    sil_mask = core['bucket'] == 'siliceous-ooze'
    warm = core[sil_mask & (core['otempC'] > 15)]
    cold = core[sil_mask & (core['otempC'] <= 15)]
    pred_series = pd.Series(pred, index=core.index)
    acc_warm = (pred_series[warm.index] == 'siliceous-ooze').mean()
    acc_cold = (pred_series[cold.index] == 'siliceous-ooze').mean()
    print(f'warm/equatorial siliceous-ooze recall (n={len(warm)}): {acc_warm:.1%}')
    print(f'cold/high-lat siliceous-ooze recall    (n={len(cold)}): {acc_cold:.1%}')
    return pred


evaluate('ovel+margin+otemp, unweighted (ADR-0011, current deployed)', ['ovelCmS', 'margin', 'otempC'], None)
evaluate('ovel+margin+otemp+osal, unweighted', ['ovelCmS', 'margin', 'otempC', 'osalPsu'], None)
evaluate('ovel+margin+otemp, class_weight=balanced', ['ovelCmS', 'margin', 'otempC'], 'balanced')
pred_balanced_osal = evaluate('ovel+margin+otemp+osal, class_weight=balanced', ['ovelCmS', 'margin', 'otempC', 'osalPsu'], 'balanced')

core['pred_balanced_osal'] = pred_balanced_osal
core.to_csv('validation_points_with_osal_balanced_pred.csv', index=False)
